"""Render the synthetic three-way sample sets (run once; outputs are committed).

Every file is SYNTHETIC: fictional supplier, fictional references, no real
customer or company data. Each document carries a visible "SYNTHETIC SAMPLE" line.

    python sample-documents/generate.py
"""
import json
import pathlib
import random
from decimal import Decimal
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / 'three-way'
EVAL = HERE / 'eval'
W, H = 1240, 1754

SETS = {
    # id: (invoice ref, po ref, grn ref, invoice lines, po lines, grn lines)
    'short-delivery': dict(
        inv='INV-0142', po='PO-7781', grn='GRN-7781', date='2026-09-20',
        inv_lines=[('SKU-1', 'Steel bracket 40mm', 200, '12.50'), ('SKU-2', 'Hex bolt M8 zinc', 500, '0.40')],
        po_lines=[('SKU-1', 'Steel bracket 40mm', 200, '12.47'), ('SKU-2', 'Hex bolt M8 zinc', 500, '0.40')],
        grn_lines=[('SKU-1', 'Steel bracket 40mm', 180), ('SKU-2', 'Hex bolt M8 zinc', 500)]),
    'clean': dict(
        inv='INV-0143', po='PO-7782', grn='GRN-7782', date='2026-09-21',
        inv_lines=[('SKU-3', 'Pipe clamp 25mm', 120, '3.20'), ('SKU-4', 'Wall anchor 8mm', 400, '0.15')],
        po_lines=[('SKU-3', 'Pipe clamp 25mm', 120, '3.20'), ('SKU-4', 'Wall anchor 8mm', 400, '0.15')],
        grn_lines=[('SKU-3', 'Pipe clamp 25mm', 120), ('SKU-4', 'Wall anchor 8mm', 400)]),
}
SUPPLIER = 'Atlas Industrial Supply (fictional)'
BUYER = 'Carthage Fabrication SARL (fictional)'
VAT_RATE = '0.19'


def money(value):
    return f'{value:.2f}'


def font(size, mono=False, bold=False):
    names = (['consolab.ttf'] if bold else ['consola.ttf']) if mono else (['arialbd.ttf'] if bold else ['arial.ttf'])
    names += ['DejaVuSansMono.ttf' if mono else 'DejaVuSans.ttf']
    for name in names:
        for base in ('C:/Windows/Fonts/', '/usr/share/fonts/truetype/dejavu/', ''):
            try:
                return ImageFont.truetype(base + name, size)
            except OSError:
                continue
    return ImageFont.load_default(size=size)


def totals(lines):
    from decimal import Decimal
    net = sum(Decimal(q) * Decimal(p) for _, _, q, p in lines)
    vat = (net * Decimal(VAT_RATE)).quantize(Decimal('0.01'))
    return net, vat, net + vat


def render_invoice(spec, path):
    from decimal import Decimal
    image = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(image)
    ink, grey = (20, 34, 27), (95, 107, 99)
    d.rectangle([0, 0, W, 64], fill=(254, 240, 199))
    d.text((80, 18), 'SYNTHETIC SAMPLE - NOT A REAL INVOICE - VARELQ DEMO DATA', font=font(24, bold=True), fill=(181, 71, 8))
    d.text((80, 120), 'INVOICE', font=font(56, bold=True), fill=ink)
    d.text((80, 200), SUPPLIER, font=font(28, bold=True), fill=ink)
    d.text((80, 240), '12 Rue de l\'Industrie, Ben Arous, Tunisia', font=font(24), fill=grey)
    y = 320
    for label, value in (('Invoice number', spec['inv']), ('Invoice date', spec['date']),
                         ('Order reference', spec['po']), ('Bill to', BUYER), ('Currency', 'TND')):
        d.text((80, y), label, font=font(24), fill=grey)
        d.text((400, y), value, font=font(24, mono=True), fill=ink)
        y += 44
    y += 40
    d.line([80, y, W - 80, y], fill=ink, width=2)
    y += 16
    mono = font(26, mono=True)
    d.text((80, y), f'{"SKU":<7}{"Description":<22}{"Qty":>6}{"Unit price":>12}{"Amount":>11}', font=font(26, mono=True, bold=True), fill=ink)
    y += 48
    d.line([80, y, W - 80, y], fill=(197, 205, 198), width=1)
    y += 20
    for sku, desc, qty, price in spec['inv_lines']:
        amount = money(Decimal(qty) * Decimal(price))
        d.text((80, y), f'{sku:<7}{desc:<22}{qty:>6}{price:>12}{amount:>11}', font=mono, fill=ink)
        y += 56
    d.line([80, y, W - 80, y], fill=ink, width=2)
    y += 30
    net, vat, total = totals(spec['inv_lines'])
    for label, value in (('Net amount TND', money(net)), ('VAT 19% TND', money(vat)), ('Total due TND', money(total))):
        bold = label.startswith('Total')
        d.text((620, y), f'{label:<16}{value:>12}', font=font(28 if bold else 26, mono=True, bold=bold), fill=ink)
        y += 52
    d.text((80, H - 160), 'Payment terms: 30 days from invoice date.', font=font(22), fill=grey)
    d.text((80, H - 120), 'Synthetic document generated for VARELQ reconciliation tests.', font=font(22), fill=grey)
    image.save(path, format='PNG', optimize=True)


def render_po(spec):
    from decimal import Decimal
    net, vat, total = totals(spec['po_lines'])
    rows = '\n'.join(f'{sku} | {desc} | {qty} | {price} | {money(Decimal(qty) * Decimal(price))}' for sku, desc, qty, price in spec['po_lines'])
    return (f'SYNTHETIC SAMPLE - NOT A REAL PURCHASE ORDER - VARELQ DEMO DATA\n'
            f'PURCHASE ORDER {spec["po"]}\nBuyer: {BUYER}\nSupplier: {SUPPLIER}\nOrder date: 2026-09-10\nCurrency: TND\n'
            f'SKU | Description | Quantity | Unit price | Line total\n{rows}\n'
            f'Net: {money(net)} TND\nVAT rate: 19%\nVAT: {money(vat)} TND\nTotal: {money(total)} TND\n')


def render_grn(spec):
    rows = '\n'.join(f'{sku} | {desc} | {qty}' for sku, desc, qty in spec['grn_lines'])
    return (f'SYNTHETIC SAMPLE - NOT A REAL GOODS RECEIPT - VARELQ DEMO DATA\n'
            f'GOODS RECEIVED NOTE {spec["grn"]}\nOrder reference: {spec["po"]}\nSupplier: {SUPPLIER}\n'
            f'Received at: Carthage Fabrication warehouse, 2026-09-18\n'
            f'SKU | Description | Quantity received\n{rows}\nReceived by: warehouse clerk (fictional)\n')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for spec in SETS.values():
        render_invoice(spec, OUT / f'invoice-{spec["inv"].split("-")[1]}.png')
        (OUT / f'po-{spec["po"].split("-")[1]}.txt').write_text(render_po(spec), encoding='utf-8', newline='\n')
        (OUT / f'grn-{spec["grn"].split("-")[1]}.txt').write_text(render_grn(spec), encoding='utf-8', newline='\n')
    print('wrote', sorted(p.name for p in OUT.iterdir()))


# ---------------------------------------------------------------------------
# Evaluation sets (sample-documents/eval/). All SYNTHETIC. Each spec carries its
# own supplier, currency and VAT rate; `findings` is the planted ground truth.
# Optional per-spec overrides:
#   inv_currency  currency printed on the invoice (defaults to `currency`)
#   inv_vat       VAT amount printed on the invoice (a deliberate miscalculation)
#   degrade       render as a degraded scan (rotation, blur, grey paper noise, JPEG q35)
# ---------------------------------------------------------------------------
EVAL_BUYER = 'Carthage Fabrication SARL (fictional)'
EVAL_SETS = [
    dict(id='eval-clean-tnd-1line', inv='INV-2001', po='PO-9101', grn='GRN-9101', date='2026-08-03',
         supplier='Medina Office Supplies (fictional)', address='4 Avenue Habib Bourguiba, Sfax, Tunisia',
         currency='TND', vat='19', degrade=False,
         inv_lines=[('PAP-A4', 'Copy paper A4 80g box', 40, '38.900')],
         po_lines=[('PAP-A4', 'Copy paper A4 80g box', 40, '38.900')],
         grn_lines=[('PAP-A4', 'Copy paper A4 80g box', 40)],
         findings=[]),
    dict(id='eval-clean-eur-4lines', inv='FA-26-0588', po='PO-9102', grn='GRN-9102', date='2026-08-11',
         supplier='Rhone Hydraulique SAS (fictional)', address='18 Quai Perrache, Lyon, France',
         currency='EUR', vat='20', degrade=True,
         inv_lines=[('HY-101', 'Hydraulic hose 1/2in 2m', 25, '18.40'), ('HY-205', 'Quick coupler steel', 60, '7.95'),
                    ('HY-310', 'Pressure gauge 250bar', 6, '42.00'), ('HY-412', 'O-ring kit NBR', 10, '15.60')],
         po_lines=[('HY-101', 'Hydraulic hose 1/2in 2m', 25, '18.40'), ('HY-205', 'Quick coupler steel', 60, '7.95'),
                   ('HY-310', 'Pressure gauge 250bar', 6, '42.00'), ('HY-412', 'O-ring kit NBR', 10, '15.60')],
         grn_lines=[('HY-101', 'Hydraulic hose 1/2in 2m', 25), ('HY-205', 'Quick coupler steel', 60),
                    ('HY-310', 'Pressure gauge 250bar', 6), ('HY-412', 'O-ring kit NBR', 10)],
         findings=[]),
    dict(id='eval-clean-mad-6lines', inv='F2026-1177', po='PO-9103', grn='GRN-9103', date='2026-08-19',
         supplier='Atlas Emballage SARL (fictional)', address='Zone Industrielle Ain Sebaa, Casablanca, Morocco',
         currency='MAD', vat='20', degrade=False,
         inv_lines=[('CB-40', 'Carton box 40x30x30', 500, '6.80'), ('CB-60', 'Carton box 60x40x40', 300, '11.20'),
                    ('TP-48', 'Packing tape 48mm', 120, '9.50'), ('SW-50', 'Stretch wrap 50cm', 40, '64.00'),
                    ('BW-10', 'Bubble wrap roll 10m', 30, '48.75'), ('LB-A6', 'Shipping label A6 roll', 25, '37.40')],
         po_lines=[('CB-40', 'Carton box 40x30x30', 500, '6.80'), ('CB-60', 'Carton box 60x40x40', 300, '11.20'),
                   ('TP-48', 'Packing tape 48mm', 120, '9.50'), ('SW-50', 'Stretch wrap 50cm', 40, '64.00'),
                   ('BW-10', 'Bubble wrap roll 10m', 30, '48.75'), ('LB-A6', 'Shipping label A6 roll', 25, '37.40')],
         grn_lines=[('CB-40', 'Carton box 40x30x30', 500), ('CB-60', 'Carton box 60x40x40', 300),
                    ('TP-48', 'Packing tape 48mm', 120), ('SW-50', 'Stretch wrap 50cm', 40),
                    ('BW-10', 'Bubble wrap roll 10m', 30), ('LB-A6', 'Shipping label A6 roll', 25)],
         findings=[]),
    dict(id='eval-price-mismatch-tnd', inv='INV-2004', po='PO-9104', grn='GRN-9104', date='2026-08-22',
         supplier='Sahel Electrique (fictional)', address='Route de Monastir km 3, Sousse, Tunisia',
         currency='TND', vat='19', degrade=True,
         inv_lines=[('CB-2.5', 'Cable H07V-U 2.5mm2 100m', 12, '92.500'), ('DJ-16', 'Circuit breaker 16A', 30, '14.800'),
                    ('BX-12', 'Junction box IP55', 50, '6.250')],
         po_lines=[('CB-2.5', 'Cable H07V-U 2.5mm2 100m', 12, '89.000'), ('DJ-16', 'Circuit breaker 16A', 30, '14.800'),
                   ('BX-12', 'Junction box IP55', 50, '6.250')],
         grn_lines=[('CB-2.5', 'Cable H07V-U 2.5mm2 100m', 12), ('DJ-16', 'Circuit breaker 16A', 30),
                    ('BX-12', 'Junction box IP55', 50)],
         findings=[dict(kind='price_mismatch', sku='CB-2.5', invoice='92.500', po='89.000', delta_total='42.000')]),
    dict(id='eval-short-delivery-eur', inv='FA-26-0611', po='PO-9105', grn='GRN-9105', date='2026-08-25',
         supplier='Bordeaux Fixations SA (fictional)', address='7 Rue des Chartrons, Bordeaux, France',
         currency='EUR', vat='20', degrade=False,
         inv_lines=[('FX-M6', 'Machine screw M6x20', 1000, '0.12'), ('FX-W6', 'Flat washer M6', 1000, '0.03')],
         po_lines=[('FX-M6', 'Machine screw M6x20', 1000, '0.12'), ('FX-W6', 'Flat washer M6', 1000, '0.03')],
         grn_lines=[('FX-M6', 'Machine screw M6x20', 750), ('FX-W6', 'Flat washer M6', 1000)],
         findings=[dict(kind='short_delivery', sku='FX-M6', invoiced=1000, received=750, delta_qty=-250)]),
    dict(id='eval-over-invoicing-mad', inv='F2026-1203', po='PO-9106', grn='GRN-9106', date='2026-08-28',
         supplier='Fes Textile Industrie (fictional)', address='Quartier Industriel Sidi Brahim, Fes, Morocco',
         currency='MAD', vat='20', degrade=False,
         inv_lines=[('WG-L', 'Work gloves size L', 260, '14.50'), ('CV-M', 'Coverall cotton size M', 80, '118.00'),
                    ('HV-V', 'Hi-vis vest', 150, '22.00')],
         po_lines=[('WG-L', 'Work gloves size L', 200, '14.50'), ('CV-M', 'Coverall cotton size M', 80, '118.00'),
                   ('HV-V', 'Hi-vis vest', 150, '22.00')],
         grn_lines=[('WG-L', 'Work gloves size L', 200), ('CV-M', 'Coverall cotton size M', 80),
                    ('HV-V', 'Hi-vis vest', 150)],
         findings=[dict(kind='over_invoicing', sku='WG-L', invoiced=260, ordered=200, received=200, delta_qty=60)]),
    dict(id='eval-vat-miscalc-tnd', inv='INV-2007', po='PO-9107', grn='GRN-9107', date='2026-09-01',
         supplier='Cap Bon Plastiques (fictional)', address='Zone Industrielle, Nabeul, Tunisia',
         currency='TND', vat='19', inv_vat='245.000', degrade=True,
         inv_lines=[('PE-200', 'PE drum 200L', 10, '85.000'), ('PP-20', 'PP jerrycan 20L', 60, '9.500'),
                    ('LD-5', 'LDPE bottle 5L', 100, '2.400'), ('CP-63', 'Screw cap 63mm', 500, '0.180')],
         po_lines=[('PE-200', 'PE drum 200L', 10, '85.000'), ('PP-20', 'PP jerrycan 20L', 60, '9.500'),
                   ('LD-5', 'LDPE bottle 5L', 100, '2.400'), ('CP-63', 'Screw cap 63mm', 500, '0.180')],
         grn_lines=[('PE-200', 'PE drum 200L', 10), ('PP-20', 'PP jerrycan 20L', 60),
                    ('LD-5', 'LDPE bottle 5L', 100), ('CP-63', 'Screw cap 63mm', 500)],
         findings=[dict(kind='vat_miscalculation', invoice_vat='245.000', correct_vat='332.500', rate='19%', delta='-87.500')]),
    dict(id='eval-missing-receipt-eur', inv='FA-26-0640', po='PO-9108', grn='GRN-9108', date='2026-09-04',
         supplier='Porto Ferragens Lda (fictional)', address='Rua do Almada 210, Porto, Portugal',
         currency='EUR', vat='23', degrade=False,
         inv_lines=[('HG-35', 'Cabinet hinge 35mm', 200, '1.85'), ('DH-128', 'Drawer handle 128mm', 120, '3.40'),
                    ('SL-450', 'Drawer slide 450mm pair', 60, '9.90')],
         po_lines=[('HG-35', 'Cabinet hinge 35mm', 200, '1.85'), ('DH-128', 'Drawer handle 128mm', 120, '3.40'),
                   ('SL-450', 'Drawer slide 450mm pair', 60, '9.90')],
         grn_lines=[('HG-35', 'Cabinet hinge 35mm', 200), ('DH-128', 'Drawer handle 128mm', 120)],
         findings=[dict(kind='missing_receiving_record', sku='SL-450', invoiced=60, received=None)]),
    dict(id='eval-duplicate-line-mad', inv='F2026-1250', po='PO-9109', grn='GRN-9109', date='2026-09-08',
         supplier='Marrakech Agro Equipement (fictional)', address='Route de Safi km 6, Marrakech, Morocco',
         currency='MAD', vat='20', degrade=False,
         inv_lines=[('DR-16', 'Drip line 16mm 100m', 15, '240.00'), ('EM-2', 'Emitter 2L/h pack 100', 20, '55.00'),
                    ('DR-16', 'Drip line 16mm 100m', 15, '240.00')],
         po_lines=[('DR-16', 'Drip line 16mm 100m', 15, '240.00'), ('EM-2', 'Emitter 2L/h pack 100', 20, '55.00')],
         grn_lines=[('DR-16', 'Drip line 16mm 100m', 15), ('EM-2', 'Emitter 2L/h pack 100', 20)],
         findings=[dict(kind='duplicate_line', sku='DR-16', occurrences=2, overbilled='3600.00')]),
    dict(id='eval-currency-mismatch', inv='INV-2010', po='PO-9110', grn='GRN-9110', date='2026-09-12',
         supplier='Bizerte Marine Services (fictional)', address='Port de Peche, Bizerte, Tunisia',
         currency='TND', inv_currency='EUR', vat='19', degrade=True,
         inv_lines=[('RP-12', 'Mooring rope 12mm 50m', 8, '145.00'), ('FD-30', 'Boat fender 30cm', 24, '38.50')],
         po_lines=[('RP-12', 'Mooring rope 12mm 50m', 8, '145.000'), ('FD-30', 'Boat fender 30cm', 24, '38.500')],
         grn_lines=[('RP-12', 'Mooring rope 12mm 50m', 8), ('FD-30', 'Boat fender 30cm', 24)],
         findings=[dict(kind='currency_mismatch', invoice_currency='EUR', po_currency='TND')]),
]


def _q(currency):
    return Decimal('0.001') if currency == 'TND' else Decimal('0.01')


def _fmt(value, currency):
    return str(Decimal(value).quantize(_q(currency)))


def eval_totals(lines, rate, currency):
    net = sum(Decimal(q) * Decimal(p) for _, _, q, p in lines).quantize(_q(currency))
    vat = (net * Decimal(rate) / 100).quantize(_q(currency))
    return net, vat, net + vat


def degrade(image, seed):
    """Realistic scan: grey paper tint + noise, 1-3 deg rotation, mild blur. Caller saves as JPEG q35."""
    rng = random.Random(seed)
    paper = Image.new('RGB', image.size, (222, 219, 210))
    image = Image.blend(image, paper, 0.22)
    angle = round(rng.uniform(1.0, 3.0) * rng.choice((-1, 1)), 2)
    image = image.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=(200, 197, 189))
    image = image.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.8, 1.2)))
    noise = Image.effect_noise(image.size, 40).convert('RGB')
    image = Image.blend(image, noise, 0.08)
    return image.resize((int(image.width * 0.8), int(image.height * 0.8)), Image.BILINEAR), angle


def render_eval_invoice(spec, path):
    cur = spec.get('inv_currency', spec['currency'])
    image = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(image)
    ink, grey = (20, 34, 27), (95, 107, 99)
    d.rectangle([0, 0, W, 64], fill=(254, 240, 199))
    d.text((80, 18), 'SYNTHETIC SAMPLE - NOT A REAL INVOICE - VARELQ DEMO DATA', font=font(24, bold=True), fill=(181, 71, 8))
    d.text((80, 120), 'INVOICE', font=font(56, bold=True), fill=ink)
    d.text((80, 200), spec['supplier'], font=font(28, bold=True), fill=ink)
    d.text((80, 240), spec['address'], font=font(24), fill=grey)
    y = 320
    for label, value in (('Invoice number', spec['inv']), ('Invoice date', spec['date']),
                         ('Order reference', spec['po']), ('Bill to', EVAL_BUYER), ('Currency', cur)):
        d.text((80, y), label, font=font(24), fill=grey)
        d.text((400, y), value, font=font(24, mono=True), fill=ink)
        y += 44
    y += 40
    d.line([80, y, W - 80, y], fill=ink, width=2)
    y += 16
    mono = font(24, mono=True)
    d.text((80, y), f'{"SKU":<8}{"Description":<26}{"Qty":>6}{"Unit price":>12}{"Amount":>13}', font=font(24, mono=True, bold=True), fill=ink)
    y += 48
    d.line([80, y, W - 80, y], fill=(197, 205, 198), width=1)
    y += 20
    for sku, desc, qty, price in spec['inv_lines']:
        amount = _fmt(Decimal(qty) * Decimal(price), cur)
        d.text((80, y), f'{sku:<8}{desc[:25]:<26}{qty:>6}{price:>12}{amount:>13}', font=mono, fill=ink)
        y += 52
    d.line([80, y, W - 80, y], fill=ink, width=2)
    y += 30
    net, vat, total = eval_totals(spec['inv_lines'], spec['vat'], cur)
    if 'inv_vat' in spec:
        vat = Decimal(spec['inv_vat'])
        total = net + vat
    for label, value in ((f'Net amount {cur}', net), (f'VAT {spec["vat"]}% {cur}', vat), (f'Total due {cur}', total)):
        bold = label.startswith('Total')
        d.text((520, y), f'{label:<18}{_fmt(value, cur):>14}', font=font(28 if bold else 26, mono=True, bold=bold), fill=ink)
        y += 52
    d.text((80, H - 160), 'Payment terms: 30 days from invoice date.', font=font(22), fill=grey)
    d.text((80, H - 120), 'Synthetic document generated for VARELQ reconciliation tests.', font=font(22), fill=grey)
    if not spec.get('degrade'):
        image.save(path, format='PNG', optimize=True)
        return None
    image, angle = degrade(image, spec['id'])
    image.save(path, format='JPEG', quality=35)
    return {'rotation_deg': angle, 'blur': 'gaussian radius 0.8-1.2', 'jpeg_quality': 35, 'paper': 'grey tint + noise', 'scale': 0.8}


def render_eval_po(spec):
    cur = spec['currency']
    net, vat, total = eval_totals(spec['po_lines'], spec['vat'], cur)
    rows = '\n'.join(f'{s} | {d} | {q} | {p} | {_fmt(Decimal(q) * Decimal(p), cur)}' for s, d, q, p in spec['po_lines'])
    return (f'SYNTHETIC SAMPLE - NOT A REAL PURCHASE ORDER - VARELQ DEMO DATA\n'
            f'PURCHASE ORDER {spec["po"]}\nBuyer: {EVAL_BUYER}\nSupplier: {spec["supplier"]}\nOrder date: 2026-07-28\nCurrency: {cur}\n'
            f'SKU | Description | Quantity | Unit price | Line total\n{rows}\n'
            f'Net: {_fmt(net, cur)} {cur}\nVAT rate: {spec["vat"]}%\nVAT: {_fmt(vat, cur)} {cur}\nTotal: {_fmt(total, cur)} {cur}\n')


def render_eval_grn(spec):
    rows = '\n'.join(f'{s} | {d} | {q}' for s, d, q in spec['grn_lines'])
    return (f'SYNTHETIC SAMPLE - NOT A REAL GOODS RECEIPT - VARELQ DEMO DATA\n'
            f'GOODS RECEIVED NOTE {spec["grn"]}\nOrder reference: {spec["po"]}\nSupplier: {spec["supplier"]}\n'
            f'Received at: Carthage Fabrication warehouse, {spec["date"]}\n'
            f'SKU | Description | Quantity received\n{rows}\nReceived by: warehouse clerk (fictional)\n')


def main_eval():
    """Write sample-documents/eval/ and merge the eval entries into manifest.json (other entries kept)."""
    EVAL.mkdir(parents=True, exist_ok=True)
    entries = []
    for spec in EVAL_SETS:
        base = spec['id'][len('eval-'):]
        ext = 'jpg' if spec.get('degrade') else 'png'
        inv_path, po_path, grn_path = EVAL / f'{base}-invoice.{ext}', EVAL / f'{base}-po.txt', EVAL / f'{base}-grn.txt'
        meta = render_eval_invoice(spec, inv_path)
        po_path.write_text(render_eval_po(spec), encoding='utf-8', newline='\n')
        grn_path.write_text(render_eval_grn(spec), encoding='utf-8', newline='\n')
        kinds = [f['kind'] for f in spec['findings']]
        entry = dict(id=spec['id'], title=f'{spec["inv"]} vs {spec["po"]} vs {spec["grn"]}', synthetic=True,
                     expected='differences' if kinds else 'no differences',
                     expected_findings=spec['findings'],
                     description=('Synthetic eval set' + (f' (planted: {", ".join(kinds)})' if kinds else ' (clean control)')
                                  + f'; {spec["currency"]}, {len(spec["inv_lines"])} invoice line(s)'
                                  + ('; degraded scan' if meta else '') + '.'),
                     files={'invoice': {'path': f'eval/{inv_path.name}', 'content_type': 'image/jpeg' if meta else 'image/png'},
                            'purchase_order': {'path': f'eval/{po_path.name}', 'content_type': 'text/plain'},
                            'receiving_record': {'path': f'eval/{grn_path.name}', 'content_type': 'text/plain'}})
        if meta:
            entry['degradation'] = meta
        entries.append(entry)
    manifest_path = HERE / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    ids = {e['id'] for e in entries}
    manifest['samples'] = [s for s in manifest['samples'] if s['id'] not in ids] + entries
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
    print('wrote', len(entries), 'eval sets to', EVAL)


if __name__ == '__main__':
    import sys
    if '--eval-only' not in sys.argv:
        main()
    main_eval()
