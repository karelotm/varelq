"""Score raw VARELQ responses from run_eval.py against dataset ground truth.

Usage:
    python scripts/eval/score.py --raw <dir>/raw --out scripts/eval/results.json [--code-version "<text>"]

Metrics (every number comes from the stored raw responses and the ground-truth files in the repo):
- SROIE (public-data/sroie/NNN.json): company vs extracted supplier (token-sort ratio >= 0.9), date (normalised to
  ISO; only if the response carries a date field), address (token-sort ratio >= 0.9; only if a field exists),
  total (numeric, |diff| <= 0.01).
- OCR character error rate vs the SROIE box text (NNN.csv). Each ground-truth line is aligned one-to-one with the
  most similar OCR block (greedy, highest similarity first); unmatched ground-truth lines count as full deletions.
  Reported over all characters (case-sensitive and case-insensitive; SROIE box text is mostly upper case) and case-insensitive over letters and digits only.
- OCR label quality: each OCR block gets the app's band (Verify < 0.80, Check 0.80-0.90, none >= 0.90); the block
  is "wrong" unless its text (whitespace-normalised, case-insensitive) equals, or is a contiguous part of, its
  best-matching ground-truth line. Blocks whose best match is below 0.5 similarity are excluded as unmatched.
- CORD (public-data/cord/receipt-NNN.json): total, tax and subtotal vs extracted total, vat and net; menu prices vs
  extracted item line totals. Amounts normalised from Indonesian formatting ("60.000" and "28,000" are thousands).
- Synthetic three-way sets: planted discrepancy detected as a 'difference' check (TP) or not (FN); any other
  difference is a false positive; clean controls must have zero differences. Findings the app only surfaces as a
  limitation text are counted separately as "surfaced", never as detected.
- Latency p50/p95 (OCR latency_ms per page, total wall time per request), OCR and LLM fallback usage, request errors.
"""
import argparse
import csv
import difflib
import json
import math
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SROIE = ROOT / 'public-data' / 'sroie'
CORD = ROOT / 'public-data' / 'cord'


# ---------------------------------------------------------------- helpers

def wilson(k, n, z=1.96):
    if not n:
        return None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(max(0.0, c - h), 3), round(min(1.0, c + h), 3)]


def prop(k, n):
    return {'k': k, 'n': n, 'value': round(k / n, 3) if n else None, 'wilson95': wilson(k, n)}


def pct(values, q):
    if not values:
        return None
    s = sorted(values)
    idx = (len(s) - 1) * q
    lo, hi = math.floor(idx), math.ceil(idx)
    return round(s[lo] + (s[hi] - s[lo]) * (idx - lo), 1)


def norm_text(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^0-9A-Z&@ ]+', ' ', str(s or '').upper())).strip()


def token_ratio(a, b):
    a, b = ' '.join(sorted(norm_text(a).split())), ' '.join(sorted(norm_text(b).split()))
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def levenshtein(a, b):
    if a == b:
        return 0
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def money(value):
    """Numeric value of a printed amount; handles RM29.30, $8.20, 60.000 (IDR thousands), 28,000, Rp. 111,000."""
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    s = re.sub(r'[^0-9.,\-]', '', str(value))
    if not re.search(r'\d', s):
        return None
    neg = s.startswith('-')
    s = s.lstrip('-')
    if re.fullmatch(r'\d{1,3}([.,]\d{3})+', s):  # thousands separators only
        s = re.sub(r'[.,]', '', s)
    else:
        if ',' in s and '.' in s:
            s = s.replace(',', '') if s.rfind('.') > s.rfind(',') else s.replace('.', '').replace(',', '.')
        s = s.replace(',', '.')
        if s.count('.') > 1:
            head, tail = s.rsplit('.', 1)
            s = head.replace('.', '') + '.' + tail
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def parse_date(value):
    if not value:
        return None
    s = str(value).strip().upper().replace('.', '/')
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d/%m/%y', '%d-%m-%Y', '%d-%m-%y', '%d %b %Y', '%d %B %Y', '%d-%b-%Y',
                '%d %b %y', '%Y/%m/%d', '%d%b%Y'):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    m = re.search(r'(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})', s)
    if m:
        d, mo, y = m.groups()
        y = int(y) + (2000 if len(y) == 2 else 0)
        try:
            return datetime(int(y), int(mo), int(d)).date().isoformat()
        except ValueError:
            return None
    return None


def val(cell):
    return cell.get('value') if isinstance(cell, dict) else cell


def field_like(inv, word):
    """Return (key, value) of the first invoice field whose name contains `word` (e.g. a future 'date' field)."""
    for key, cell in (inv or {}).items():
        if word in key and key != 'items' and val(cell) not in (None, ''):
            return key, val(cell)
    for key in (inv or {}):
        if word in key and key != 'items':
            return key, None
    return None, None


# ---------------------------------------------------------------- OCR

def ocr_blocks(resp):
    blocks = []
    for page in ((resp.get('sources') or {}).get('invoice') or {}).get('ocr_pages') or []:
        for b in page.get('blocks') or []:
            blocks.append({'text': b.get('text') or '', 'conf': b.get('ocr_confidence')})
    return blocks


def sroie_box_lines(rid):
    lines = []
    with open(SROIE / f'{rid}.csv', encoding='utf-8', errors='replace') as fh:
        for row in csv.reader(fh):
            if len(row) >= 9:
                text = ','.join(row[8:]).strip()
                if text:
                    lines.append(text)
    return lines


def align(gt_lines, blocks):
    """Greedy one-to-one alignment by similarity. Returns {gt_index: block_index}."""
    pairs = []
    for i, g in enumerate(gt_lines):
        for j, b in enumerate(blocks):
            r = difflib.SequenceMatcher(None, g.upper(), b['text'].upper()).ratio()
            if r > 0:
                pairs.append((r, i, j))
    pairs.sort(reverse=True)
    used_g, used_b, out = set(), set(), {}
    for r, i, j in pairs:
        if i not in used_g and j not in used_b:
            used_g.add(i), used_b.add(j)
            out[i] = j
    return out


def cer_counts(gt_lines, blocks, mapping):
    all_err = all_n = an_err = an_n = ci_err = 0
    for i, g in enumerate(gt_lines):
        hyp = blocks[mapping[i]]['text'] if i in mapping else ''
        all_err += levenshtein(g, hyp)
        ci_err += levenshtein(g.upper(), hyp.upper())
        all_n += len(g)
        ga, ha = re.sub(r'[^0-9A-Za-z]', '', g).upper(), re.sub(r'[^0-9A-Za-z]', '', hyp).upper()
        an_err += levenshtein(ga, ha)
        an_n += len(ga)
    return all_err, all_n, an_err, an_n, ci_err


def band(conf):
    if not isinstance(conf, (int, float)):
        return 'none'
    return 'verify' if conf < 0.80 else 'check' if conf < 0.90 else 'none'


def label_rows(gt_lines, blocks):
    rows = []
    ng = [re.sub(r'\s+', ' ', g).strip().upper() for g in gt_lines]
    for b in blocks:
        t = re.sub(r'\s+', ' ', b['text']).strip().upper()
        if not t:
            continue
        best, score = None, 0.0
        for g in ng:
            r = difflib.SequenceMatcher(None, t, g).ratio()
            if t and t in g:
                r = max(r, 0.99 if len(t) >= 3 else r)
            if r > score:
                best, score = g, r
        if score < 0.5:
            continue
        rows.append({'text': b['text'], 'conf': b['conf'], 'band': band(b['conf']), 'wrong': not (t == best or t in best),
                     'truth': best})
    return rows


# ---------------------------------------------------------------- datasets

def score_sroie(raws):
    per, cer = [], [0, 0, 0, 0, 0]
    labels = []
    counts = {k: [0, 0] for k in ('company', 'date', 'address', 'total')}
    missing_schema = {'date': 0, 'address': 0}
    for rid, rec in sorted(raws.items()):
        key = json.loads((SROIE / f'{rid}.json').read_text(encoding='utf-8'))
        row = {'id': rid, 'ok': rec['ok']}
        if not rec['ok']:
            per.append(row)
            continue
        resp = rec['response']
        inv = (resp.get('fields') or {}).get('invoice') or {}
        row['llm_fallback'] = bool(resp.get('fallback_used'))
        supplier = val(inv.get('supplier'))
        r = token_ratio(key['company'], supplier)
        contained = bool(norm_text(key['company'])) and set(norm_text(key['company']).split()) <= set(norm_text(supplier).split())
        row['company'] = {'truth': key['company'], 'got': supplier, 'ratio': round(r, 3), 'ok': r >= 0.9,
                          'ok_lenient': r >= 0.9 or contained}
        t_truth, t_got = money(key['total']), money(val(inv.get('total')))
        row['total'] = {'truth': key['total'], 'got': val(inv.get('total')),
                        'ok': t_got is not None and t_truth is not None and abs(t_got - t_truth) <= 0.01}
        dkey, dval = field_like(inv, 'date')
        if dkey is None:
            missing_schema['date'] += 1
            row['date'] = {'truth': key['date'], 'got': None, 'ok': False, 'note': 'no date field in response'}
        else:
            row['date'] = {'truth': key['date'], 'got': dval, 'field': dkey,
                           'ok': parse_date(dval) is not None and parse_date(dval) == parse_date(key['date'])}
        akey, aval = field_like(inv, 'address')
        if akey is None:
            missing_schema['address'] += 1
            row['address'] = {'truth': key['address'], 'got': None, 'ok': False, 'note': 'no address field in response'}
        else:
            ar = token_ratio(key['address'], aval)
            row['address'] = {'truth': key['address'], 'got': aval, 'field': akey, 'ratio': round(ar, 3), 'ok': ar >= 0.9}
        for k in counts:
            counts[k][0] += row[k]['ok']
            counts[k][1] += 1
        gt = sroie_box_lines(rid)
        blocks = ocr_blocks(resp)
        if blocks:
            c = cer_counts(gt, blocks, align(gt, blocks))
            cer = [a + b for a, b in zip(cer, c)]
            row['cer_all'] = round(c[0] / c[1], 4) if c[1] else None
            row['cer_alnum'] = round(c[2] / c[3], 4) if c[3] else None
            row['cer_all_case_insensitive'] = round(c[4] / c[1], 4) if c[1] else None
            lr = label_rows(gt, blocks)
            for x in lr:
                x['id'] = rid
            labels += lr
        per.append(row)
    lab = {}
    for b in ('verify', 'check', 'none'):
        rows = [x for x in labels if x['band'] == b]
        lab[b] = {'blocks': len(rows), 'wrong': sum(x['wrong'] for x in rows),
                  'wrong_rate': prop(sum(x['wrong'] for x in rows), len(rows))}
    wrong_total = sum(x['wrong'] for x in labels)
    flagged_wrong = sum(x['wrong'] for x in labels if x['band'] != 'none')
    flagged = sum(1 for x in labels if x['band'] != 'none')
    return {
        'n_documents': len(raws), 'n_scored': sum(1 for r in per if r['ok']),
        'fields': {k: prop(*v) for k, v in counts.items()},
        'fields_primary_llm_only': {k: prop(sum(1 for r in per if r['ok'] and not r['llm_fallback'] and r[k]['ok']),
                                            sum(1 for r in per if r['ok'] and not r['llm_fallback'])) for k in ('company', 'total')},
        'company_lenient_all_truth_tokens_contained': prop(sum(1 for r in per if r['ok'] and r['company']['ok_lenient']), counts['company'][1]),
        'fields_absent_from_schema': missing_schema,
        'ocr_cer': {'all_chars_case_sensitive': round(cer[0] / cer[1], 4) if cer[1] else None, 'errors_all': cer[0], 'chars_all': cer[1],
                    'all_chars_case_insensitive': round(cer[4] / cer[1], 4) if cer[1] else None, 'errors_all_ci': cer[4],
                    'alnum_case_insensitive': round(cer[2] / cer[3], 4) if cer[3] else None, 'errors_alnum': cer[2], 'chars_alnum': cer[3]},
        'ocr_labels': {'bands': lab, 'matched_blocks': len(labels), 'wrong_blocks': wrong_total,
                       'recall_of_wrong_by_any_label': prop(flagged_wrong, wrong_total),
                       'precision_of_labels': prop(flagged_wrong, flagged),
                       'unlabelled_wrong_examples': [{'id': x['id'], 'ocr': x['text'], 'truth': x['truth'], 'conf': x['conf']}
                                                     for x in labels if x['wrong'] and x['band'] == 'none'][:8]},
        'per_document': per,
    }


def score_cord(raws):
    per = []
    counts = {k: [0, 0] for k in ('total', 'tax', 'subtotal', 'menu_prices')}
    scale_errors = 0
    for rid, rec in sorted(raws.items()):
        gt = json.loads((CORD / f'receipt-{rid}.json').read_text(encoding='utf-8'))['expected']
        row = {'id': rid, 'ok': rec['ok']}
        if not rec['ok']:
            per.append(row)
            continue
        inv = (rec['response'].get('fields') or {}).get('invoice') or {}
        row['llm_fallback'] = bool(rec['response'].get('fallback_used'))
        pairs = {'total': ((gt.get('total') or {}).get('total_price'), val(inv.get('total'))),
                 'tax': ((gt.get('sub_total') or {}).get('tax_price'), val(inv.get('vat'))),
                 'subtotal': ((gt.get('sub_total') or {}).get('subtotal_price'), val(inv.get('net')))}
        for k, (truth, got) in pairs.items():
            if truth is None:
                row[k] = {'truth': None, 'got': got, 'scored': False}
                continue
            t, g = money(truth), money(got)
            ok = g is not None and abs(g - t) <= 0.01
            if g is not None and not ok and t and abs(g * 1000 - t) <= 0.5:
                scale_errors += 1
            row[k] = {'truth': truth, 'got': got, 'ok': ok}
            counts[k][0] += ok
            counts[k][1] += 1
        got_prices = [money(val(i.get('line_total'))) for i in inv.get('items') or []]
        got_prices = [p for p in got_prices if p is not None]
        hits = 0
        for m in gt.get('menu') or []:
            p = money(m.get('price'))
            if p is None:
                continue
            counts['menu_prices'][1] += 1
            match = next((g for g in got_prices if abs(g - p) <= 0.01), None)
            if match is not None:
                got_prices.remove(match)
                hits += 1
        counts['menu_prices'][0] += hits
        row['menu_prices_found'] = hits
        row['items_extracted'] = len(inv.get('items') or [])
        row['currency'] = val(inv.get('currency'))
        per.append(row)
    return {'n_documents': len(raws), 'n_scored': sum(1 for r in per if r['ok']),
            'fields': {k: prop(*v) for k, v in counts.items()},
            'amounts_off_by_factor_1000': scale_errors, 'per_document': per}


PLANTED = {
    'price_mismatch': ({'price_invoice_vs_order'}, True, ('price',)),
    'short_delivery': ({'qty_invoiced_vs_received', 'qty_received_vs_ordered'}, True, ('receiv', 'deliver')),
    'over_invoicing': ({'qty_invoiced_vs_ordered', 'qty_invoiced_vs_received'}, True, ('ordered',)),
    'vat_miscalculation': ({'tax_vs_rate', 'total_vs_net_plus_tax'}, False, ('tax', 'vat')),
    'missing_receiving_record': ({'qty_invoiced_vs_received', 'qty_received_vs_ordered'}, True, ('receiv',)),
    'duplicate_line': ({'line_sum_vs_net'}, False, ('unique', 'duplicate')),
    'currency_mismatch': (set(), False, ('currenc',)),
}
EXTRA_WORD = {'missing_receiving_record': 'receiv', 'duplicate_line': 'duplicate', 'currency_mismatch': 'currency',
              'vat_miscalculation': 'vat'}


def norm_sku(s):
    return re.sub(r'[^0-9A-Z]', '', str(s or '').upper())


def score_synthetic(raws):
    manifest = json.loads((ROOT / 'sample-documents' / 'manifest.json').read_text(encoding='utf-8'))
    truth = {s['id']: s for s in manifest['samples'] if s['id'].startswith('eval-')}
    per, by_type = [], {}
    fp_total = clean_ok = clean_n = 0
    fp_kinds = {}
    for sid, rec in sorted(raws.items()):
        s = truth[sid]
        row = {'id': sid, 'ok': rec['ok'], 'expected': s.get('expected')}
        planted = s.get('expected_findings') or []
        if not rec['ok']:
            for p in planted:
                by_type.setdefault(p['kind'], {'tp': 0, 'fn': 0, 'surfaced_only': 0, 'errors': 0})['errors'] += 1
            per.append(row)
            continue
        resp = rec['response']
        diffs = [c for c in resp.get('checks') or [] if c.get('status') == 'difference']
        lims = [str(x) for x in resp.get('limitations') or []]
        used = set()
        row['planted'] = []
        for p in planted:
            kinds, needs_sku, words = PLANTED.get(p['kind'], (set(), False, ()))
            sku = norm_sku(p.get('sku'))
            hit = None
            for i, c in enumerate(diffs):
                ck = c.get('kind') or ''
                cid = norm_sku(c.get('id', '').split(':', 1)[-1])
                kind_ok = ck in kinds or (EXTRA_WORD.get(p['kind']) and EXTRA_WORD[p['kind']] in ck)
                sku_ok = (not needs_sku) or (sku and sku in cid) or (ck not in kinds)
                if kind_ok and sku_ok:
                    hit = i
                    break
            t = by_type.setdefault(p['kind'], {'tp': 0, 'fn': 0, 'surfaced_only': 0, 'errors': 0})
            if hit is not None:
                used.add(hit)
                t['tp'] += 1
                row['planted'].append({'kind': p['kind'], 'detected': True, 'check': diffs[hit].get('id')})
            else:
                t['fn'] += 1
                surfaced = [l for l in lims if (sku and p.get('sku', '').upper() in l.upper()) or any(w in l.lower() for w in words)]
                if surfaced:
                    t['surfaced_only'] += 1
                row['planted'].append({'kind': p['kind'], 'detected': False, 'surfaced_in_limitations': surfaced[:2]})
        fps = [c for i, c in enumerate(diffs) if i not in used]
        # a second check on the same planted SKU/type is the same finding seen twice, not a false positive
        related = []
        for c in fps:
            cid = norm_sku(c.get('id', '').split(':', 1)[-1])
            if any(norm_sku(p.get('sku')) and norm_sku(p.get('sku')) == cid for p in planted) or \
               any(not p.get('sku') and c.get('kind') in PLANTED.get(p['kind'], (set(),))[0] for p in planted):
                related.append(c)
        fps = [c for c in fps if c not in related]
        row['extra_checks_on_planted_item'] = [c.get('id') for c in related]
        row['false_positives'] = [{'id': c.get('id'), 'observed': c.get('observed'), 'expected': c.get('expected')} for c in fps]
        row['differences'] = [c.get('id') for c in diffs]
        row['n_checks'] = len(resp.get('checks') or [])
        row['limitations'] = lims
        fp_total += len(fps)
        for c in fps:
            fp_kinds[c.get('kind')] = fp_kinds.get(c.get('kind'), 0) + 1
        if not planted:
            clean_n += 1
            clean_ok += not diffs
        per.append(row)
    tp = sum(t['tp'] for t in by_type.values())
    fn = sum(t['fn'] for t in by_type.values())
    return {'n_sets': len(raws), 'n_scored': sum(1 for r in per if r['ok']),
            'planted_by_type': by_type, 'detected': prop(tp, tp + fn),
            'false_positive_differences': fp_total, 'false_positive_kinds': fp_kinds,
            'clean_controls_with_zero_differences': prop(clean_ok, clean_n), 'per_set': per}


def ops(raws_all):
    ocr_ms, total_ms, fallback, pages, errors, statuses = [], [], 0, 0, [], {}
    endpoints, models, llm_fb = {}, {}, []
    for (ds, rid), rec in sorted(raws_all.items()):
        statuses[str(rec.get('status'))] = statuses.get(str(rec.get('status')), 0) + 1
        if not rec['ok']:
            errors.append({'dataset': ds, 'id': rid, 'status': rec.get('status'), 'error': rec.get('error')})
            continue
        total_ms.append(rec['wall_ms'])
        resp = rec['response']
        models[resp.get('model')] = models.get(resp.get('model'), 0) + 1
        if resp.get('fallback_used'):
            llm_fb.append({'dataset': ds, 'id': rid, 'model': resp.get('model'), 'reason': resp.get('fallback_reason')})
        for src in (rec['response'].get('sources') or {}).values():
            for p in src.get('ocr_pages') or []:
                pages += 1
                if isinstance(p.get('latency_ms'), (int, float)):
                    ocr_ms.append(p['latency_ms'])
                fallback += bool(p.get('fallback_used'))
                endpoints[p.get('endpoint_kind')] = endpoints.get(p.get('endpoint_kind'), 0) + 1
    return {'requests': len(raws_all), 'http_status_counts': statuses, 'errors': errors,
            'llm_models': models, 'llm_fallback_used': len(llm_fb), 'llm_fallbacks': llm_fb,
            'ocr_pages': pages, 'ocr_endpoint_kinds': endpoints, 'ocr_fallback_used': fallback,
            'latency_ms': {'ocr_p50': pct(ocr_ms, .5), 'ocr_p95': pct(ocr_ms, .95), 'ocr_n': len(ocr_ms),
                           'total_p50': pct(total_ms, .5), 'total_p95': pct(total_ms, .95), 'total_n': len(total_ms),
                           'total_mean': round(statistics.mean(total_ms), 1) if total_ms else None}}


def load(raw_dir):
    raws = {}
    for f in sorted(Path(raw_dir).glob('*__*.json')):
        rec = json.loads(f.read_text(encoding='utf-8'))
        raws[(rec['dataset'], rec['id'])] = rec
    return raws


def signature(rec):
    inv = (rec['response'].get('fields') or {}).get('invoice') or {}
    diffs = sorted(c.get('id') for c in rec['response'].get('checks') or [] if c.get('status') == 'difference')
    return {'supplier': val(inv.get('supplier')), 'total': val(inv.get('total')), 'net': val(inv.get('net')),
            'vat': val(inv.get('vat')), 'n_items': len(inv.get('items') or []), 'differences': diffs}


def repeatability(a, b):
    same_fields = same_diffs = same_ocr = n = 0
    changed = []
    for key in sorted(set(a) & set(b)):
        if not (a[key]['ok'] and b[key]['ok']):
            continue
        n += 1
        sa, sb = signature(a[key]), signature(b[key])
        ta = [x['text'] for x in ocr_blocks(a[key]['response'])]
        tb = [x['text'] for x in ocr_blocks(b[key]['response'])]
        same_ocr += ta == tb
        f_eq = all(sa[k] == sb[k] for k in ('supplier', 'total', 'net', 'vat', 'n_items'))
        same_fields += f_eq
        same_diffs += sa['differences'] == sb['differences']
        if not f_eq or sa['differences'] != sb['differences']:
            changed.append({'dataset': key[0], 'id': key[1],
                            'changed': {k: [sa[k], sb[k]] for k in sa if sa[k] != sb[k]}})
    return {'documents_in_both_runs': n, 'ocr_text_identical': prop(same_ocr, n),
            'key_fields_identical': prop(same_fields, n), 'difference_sets_identical': prop(same_diffs, n),
            'changed': changed}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--code-version', default=None)
    ap.add_argument('--repeat', default=None, help='raw directory of a second run of the same documents')
    args = ap.parse_args()
    raws = load(args.raw)
    by = lambda ds: {rid: r for (d, rid), r in raws.items() if d == ds}
    result = {'generated_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'code_version': args.code_version,
              'method': __doc__.strip().split('\n\n', 2)[-1],
              'sroie': score_sroie(by('sroie')), 'cord': score_cord(by('cord')), 'synthetic': score_synthetic(by('synthetic')),
              'operations': ops(raws)}
    if args.repeat:
        rep = load(args.repeat)
        byr = lambda ds: {rid: r for (d, rid), r in rep.items() if d == ds}
        result['repeat_run'] = {'sroie_fields': score_sroie(byr('sroie'))['fields'],
                                'cord_fields': score_cord(byr('cord'))['fields'],
                                'synthetic': {k: v for k, v in score_synthetic(byr('synthetic')).items() if k != 'per_set'},
                                'operations': ops(rep), 'agreement_with_first_run': repeatability(raws, rep)}
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps({k: result[k] for k in ('operations',)}, indent=1))


if __name__ == '__main__':
    main()
