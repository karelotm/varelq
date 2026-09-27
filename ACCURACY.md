# VARELQ accuracy report

Measured 2026-09-27 against ground truth, using stored runs plus a few live calls. Every number below names the run or data it comes from. The samples are small (two document images, one receipt, 29 agent runs), so treat these as honest spot checks, not error rates.

Run IDs used (the first 8 characters are used below):
- Synthetic three-way invoice INV-0142: `f3d8d8bb317c496f9c52550c45d6eb10` (hosted OCR, demo2), `4d97f1a0…` (hosted OCR, demo1), `53d4165ad1a14fc59c7c70d30f1a07d8` (self-hosted Brev L4 OCR, public app)
- SROIE receipt 000: `1230f004874c419d8f963ce5057d4a87` (demo2), `0e56e385…` (demo1)
- Reliability reports: `4c29b27e491b4451ac6128bfafef8228` (demo2) and `8bc602cf…`, `1f7f377e…`, `16420c55…`, `854e3823…`, `1381e902…` (demo1)
- Not scored: `be1bba179ec54a7f96494e14da4cc5af` returns 404 "Run not found" on the public app.
- Live calls made for this report: 3 OCR calls (repeat, word-level setting, 2x upscale), 1 clean-set INV-0143 end-to-end run, and 2 SROIE re-extractions from the stored OCR text.

---

## 1. Headline numbers

In short: clean documents are read almost perfectly and the invoice checks find exactly the planted problems. The one real receipt has two wrong fields, and they come from OCR misreads. The reliability rule R1 is right about half the time.

| Component | Metric | Value | Sample | Basis |
|---|---|---|---|---|
| OCR (nemotron-ocr-v2) | Character error rate, clean synthetic invoice, banner excluded | 0.21% (1/469) | 1 image, 37 blocks | f3d8, 4d97 (hosted), 53d4 (L4) vs `sample-documents/generate.py` strings |
| OCR | CER, synthetic invoice incl. orange-on-yellow banner | hosted 1.71% (9/525), L4 1.90% (10/525) | same | same |
| OCR | CER, real receipt, against a truth corrected from the image (Latin text) | 4.7% (21/444); letters and digits only 1.9% (7/362) | 1 receipt, 43 blocks | 1230 (0e56 identical) |
| OCR | CER, real receipt, against `000.csv` as-is | 25.1% case-sensitive (111/442), 9.7% case-insensitive (43/442); WER 20.0% (17/85) | 1 receipt, 44 boxes | inflated by `***` placeholders for Chinese text and a `BND` annotation error |
| OCR | Receipt lines read exactly (case-insensitive) | 31/44 | 1 receipt | 1230 |
| OCR | Hosted vs L4 text agreement | 36/37 blocks identical (only the banner differs) | 1 invoice | f3d8/4d97 vs 53d4 |
| OCR | Hosted repeatability | identical text every run; scores within 0.0036 | 2 stored + 1 live receipt, 2 stored invoice | ocr_pages |
| OCR | Latency | L4 268 ms direct OCR call (n=1; the OCR step inside app run `be1bba17…` took 458 ms); hosted 536–980 ms stored, 550–754 ms live (n=7) | 8 calls | latency_ms |
| Extraction (LLM) | Fields exactly right, synthetic three-way | 176/176 non-null fields (44/44 per run); 40/40 absent fields correctly empty | 4 runs, 2 distinct document sets | f3d8, 4d97, 53d4 + live INV-0143 |
| Extraction | Numeric values right, synthetic | 88/88 | same | Decimal equality |
| Extraction | Fields right end to end, real receipt | 7/9 in every run | 4 runs on identical OCR text | 1230, 0e56 + 2 live |
| Extraction | Model faithful to the OCR text | 9/9 (both wrong fields are OCR misreads copied word for word) | SROIE | OCR lines p1:l8, p1:l2 |
| Extraction | Run-to-run consistency, receipt | 12/13 fields identical in 4 runs; `net=9.0` invented in 2/4 | 4 runs | 0e56 and live #1 filled net |
| Extraction | Dates extracted | 0/4 (no date field in the schema) | 4 documents | `documents.py` PROMPT |
| Checks | Planted discrepancies found | 2/2 (price 12.50 vs 12.47; 200 invoiced vs 180 received), shown as 3 findings | INV-0142, 3 runs | f3d8, 4d97, 53d4 |
| Checks | False positives | 0/10 other checks on INV-0142; 0/13 on clean INV-0143 | 2 synthetic sets | live clean run |
| Reliability R1 | Hand-labelled precision | 5/10 = 50% (95% interval 24–76%); recall unknown | 10 of 22 flagged items | `r1_hand_labels.json`, identical in all 6 reports |
| Reliability | Blocked writes that are not in the reference | 13/22 = 59% (39–77%) vs 43% base rate (25/58), about 1.4x lift | 58 writes | replay block, 4c29 |
| Reliability | Reference-correct writes wrongly blocked | 9/33 = 27% (15–44%) | 33 writes | replay, all from R1 |
| Reliability | Run-level "flagged" precision | 11/14 = 79% (52–92%), recall 11/24 = 46% | 29 runs | evaluation block; **worse than flagging every run (24/29 = 83%)** |
| Reliability | Rule-output determinism | 6/6 reports identical | 6 reports | hash comparison |
| Reliability | Model explanation succeeded | 10/12 calls (2 fell back to template after HTTP 429) | 6 reports | explanation_source |
| Guard lab | S4 unsafe outcomes, baseline vs guarded | 5/5 vs 0/5 (Fisher p = 0.0079); guard actually blocked 4/5 | 1 scenario, n=5 per arm | demo2 lab_traces |
| Guard lab | False-block rate on legitimate payments | not measured (payable S0 not run) | 0 | demo2 lab_traces |
| Guard lab | demo1 lab traces usable | 0/40 (all HTTP 429) | 40 | demo1 lab_traces |

---

## 2. What the app currently says about confidence

In short: the app shows a raw OCR engine score as a percentage, with no warning colours and no explanation. That score does point at errors, but it is not a probability of being correct.

**OCR score.** The OCR API returns one score per line (`text_prediction.confidence`). There is no separate detection score; the "word" setting just copies the line score onto each word (confirmed with a live call). `ocr.py` stores it per block, `documents.py` keeps the lowest block score on each merged line, and `dist/assets/views/case.js` shows it as "OCR confidence 59.1%" next to the evidence line and in an "OCR conf." column. `documents.js` shows nothing about it.

- **What is good:** the score ranks errors well. Across 82 blocks with 10 real errors (receipt 1230 + invoice f3d8), AUROC is 0.92. Every block under 0.80 was wrong (4/4). Blocks at 0.90 and above were right 98% of the time (49/50).
- **What is misleading:** blocks scoring 0.80–0.85 were right only 60% of the time (n=5), and blocks scoring 0.85–0.90 were right 87% of the time (n=23). One clear error ("l'Industrie" read as "I'Industrie") scored 0.91. Hosted and L4 give different scores for the same correct text, up to 0.109 apart (SKU-1: 0.813 hosted, 0.922 L4).
- **What the user sees on the receipt:** the wrong invoice reference `TDD1167714` appears with "59.1%" and nothing marks it as suspect. A correct invoice line at 0.8128 and the wrong supplier at 0.8193 look the same.

**Extraction.** There is no model confidence and no per-field score. Numeric fields must appear in their cited line or they become "Not found" with a note under "Not checked" (0 values were dropped this way in 8 runs). Text fields are not compared with their cited line, though all 97 we measured did match.

**Reliability view.** Only raw fractions ("Hand-labelled precision 5/10", "Flagged 14/29", "Hits the divergent write in 9/24", replay tiles 22/58, 9/24, 9/33). No intervals, no sample-size warning, no per-finding confidence, so every R1 occurrence looks equally certain although about half are false positives. Explanations are tagged model or template, and limitations call them "hypotheses", which is good. The Cohesion row is blank because of a bug (see section 3). The guard lab shows "Unsafe x/n" with no interval.

---

## 3. Known error cases

In short: the real errors are OCR misreads on the receipt that pass straight through to the case, plus a few display bugs and misleading labels.

**OCR and extraction (receipt run 1230, repeated in 0e56 and 2 live re-extractions)**
1. Invoice reference `TD01167104` read as `TDD1167714` (score 0.591). Stored and shown as the invoice reference with no warning.
2. Supplier `BOOK TA .K (TAMAN DAYA) SDN BHD` read as `… KK … SDN HHD` (0.819). Stored as the supplier.
3. Decimal point lost: `CHANGE 1.00` read as `100` (0.841), handwritten `9.00` read as `900` (0.854). No check catches this. The total (9.00) and line item were right.
4. `AMOUNT` read as `AMOUIT` (0.863), `NO.53` as `NO.5:` (0.892). The `*` mark was not detected at all.
5. Chinese footer came out as garbage (scores 0.46 and 0.70) and is passed to the LLM as if it were real text.
6. `net = 9.0` filled in 2 of 4 runs although no net amount is printed, so the number of checks shown for the same receipt changes between 1 and 2.

**Synthetic invoice (f3d8, 4d97, 53d4)**
7. Banner "VARELQ DEMO DATA" read as "VARELL  EEMODATAA"; "l'Industrie" read as "I'Industrie" with a high score (0.91). Neither affected any extracted field.

**Code and UI issues**
8. `dist/assets/views/reliability.js` (~line 168) reads `coh.value`, but the backend writes `mean_pairwise_cosine`, so the Cohesion number is blank (confirmed in the JS served on :8390).
9. The "Suggested guard" link for retail rules R1 and R2 points to the lab's `payment_precondition` guard (supplier payments, a different domain). This implies a validation that does not exist.
10. `documents._grounded` accepts any value of 1 or less if 100 times it appears on the line (meant for VAT 19% → 0.19). It applies to every numeric field, so a unit price of 0.40 would pass on seeing "40".
11. No date fields in the extraction schema (invoice, order, received date; SROIE receipt date 25/12/2018).

**Reliability**
12. R1 fires on a literal "yes"; items such as "Yep, let's do that. Please go ahead!" look like likely false positives (items 11–22 are unlabelled).
13. The model's R1 fix contradicts itself between runs: 8bc602cf says accept "confirm, proceed, do it"; 4c29 (the demo report) says block unless the turn contains the exact word "yes". In 4 of 5 model-written fixes it recommends the literal-"yes" gate that causes the false positives.
14. Rate limits (HTTP 429) turned 2 of 12 explanation calls into template text and made all 40 demo1 lab traces fail.
15. `R1-LABELS.md` still has the `{report_id}` placeholder; 4c29b27e491b4451ac6128bfafef8228 lists the same first 10 items and can be filled in.

**Ground-truth caveats**
- `public-data/sroie/000.csv` writes `***` for Chinese lines and says `BND` where the image shows `BHD`, so raw CER against it overstates OCR error.
- The three INV-0142 runs have identical fields; they are not independent samples of different documents.

---

## 4. Improvement plan

In short: the fastest win is to stop showing the raw score as a percentage and show review flags instead; the most valuable next step is a real calibration set of about 100 receipts.

### (a) Doable in 30 minutes or less today (ranked)

| # | Change | Why (measured) | Effort | Files |
|---|---|---|---|---|
| 1 | Replace "OCR confidence 59.1%" with review bands: below 0.80 red "Verify: low OCR score"; 0.80–0.90 amber "Check"; 0.90+ no badge, raw score only in a tooltip "OCR score (not a probability)". | Red band catches 4/10 errors with 0 false flags, including the wrong reference TDD1167714. Amber adds 5 of the remaining 6 errors for 20 extra "Check" marks on correct blocks. | 30 min | `dist/assets/views/case.js` |
| 2 | Fix the blank Cohesion row: read `mean_pairwise_cosine` (fall back to `value`), show min, label "similarity, not accuracy". | Number is currently missing on screen. | 5 min | `dist/assets/views/reliability.js` |
| 3 | Tighten the prompt: "net only if a line labelled net / subtotal / amount before tax is printed". Set temperature 0 and a fixed seed in `server.nim_json`. | Should remove the 2-of-4 invented `net=9.0`; verify by re-running SROIE twice. | 10 min | `documents.py`, `server.py` |
| 4 | Check text fields against their cited line (normalised); limit the ×100 percent rule to `vat_rate`. | Closes a grounding gap (0 cases today) and the 0.40/"40" hole. | 15 min | `documents.py`, `test_documents.py` |
| 5 | Remove the `payment_precondition` link from R1/R2 ("no lab guard for this rule yet"); fill `{report_id}` in `R1-LABELS.md` with 4c29b27e491b4451ac6128bfafef8228. | Removes an implied validation that does not exist. | 10 min | `reliability.py`, `R1-LABELS.md` |
| 6 | Mark non-Latin lines scoring below 0.75 as "not reliably read" and keep them out of the extraction prompt. | Stops the garbage footer (0.46, 0.70) reaching the LLM. | 20 min | `documents.py` |
| 7 | Show the endpoint next to the score ("nemotron-ocr-v2 · NIM on Brev L4 · 268 ms") and note scores differ by endpoint. | Same correct text scored 0.813 hosted vs 0.922 L4. | 15 min | `dist/assets/views/case.js` |
| 8 | Precompute the demo reliability report and show a "template (rate-limited)" badge. | 2/12 explanations and 40/40 demo1 lab traces were lost to 429s. | 20 min | `reliability.py`, `reliability.js` |
| 9 | Add date fields (invoice, order, received) to the prompt with ISO parsing. | 0/4 dates extracted today. | 30 min | `documents.py`, `case.js`, tests |

### (b) Next steps (ranked)

1. **Store a per-field review flag** (30 min): key fields (reference, supplier, totals) with evidence below 0.80 get a stored limitation "verify against scan" and keep the decision pending. The wrong receipt reference would then carry a warning everywhere, not just in the case table.
2. **Wilson 95% intervals on every fraction** (40 min): evaluation, replay, hand labels and lab show "5/10 (24–76%), n=10, small sample".
3. **Receipt arithmetic and format checks** (45 min): cash − total = change; money amounts need 2 decimals. Catches `100` vs 1.00 and `900` vs 9.00, which the score (0.84–0.85) does not flag.
4. **Per-rule confidence labels** in the reliability view (45 min): "R1 · about 1 in 2 are real (5/10)", "R2 · not yet labelled". Replace the headline "Flagged 14/29" (worse than flag-everything) with write-level precision against the base rate (13/22 vs 43%).
5. **Calibration set** (about 150 min, about 200 OCR calls): run about 100 SROIE receipts through hosted and L4, fit a score → P(line correct) table per endpoint, and show "lines scoring like this were correct in X% of N lines". This is the only way to state an honest accuracy number for real scans.
6. **Re-read low-scoring lines** (75 min): crop the line box, upscale 2–3x, re-OCR, keep the new text only if the score rises and format checks pass. Do not upscale the whole image: the live 2x test fixed 3 lines but lost the document number and time (letter/digit errors 7 → 21 of 362). Not yet measured on crops.
7. **Label more reliability items** (60 min): R1 items 11–22, about 12 unflagged writes (for a first recall estimate) and R2's 4 occurrences.
8. **Ground the explanation prompt** (30 min): give it the measured precision and known false-positive modes, forbid recommending literal-"yes" gating, temperature 0, cache per rule and item.
9. **Improve R1 itself** (90 min, only after more labels): require an assistant turn that lists the same order and items followed by a user confirmation. Offline variants tested so far did not win (broader wording: false blocks 9 → 4 but missed 3 of 5 labelled true violations).
10. **Guard lab S0 (payable) runs** (35 min, about 20 calls): measure the false-block rate before claiming the guard is safe.
11. **Regression tests** (45 + 30 min): OCR fixtures for receipt-000 and invoice-0142/0143 with CER limits, and an extraction score test from saved run JSON, so these numbers are reproducible on every change.

---

## 5. Expanded evaluation (2026-09-27, 14:45–15:07 UTC)

In short: across 40 new documents, OCR reads clean text well and totals are usually right (18/20 SROIE). But the review labels miss about 1 in 4 wrong OCR lines, dates and addresses are not extracted at all, Indonesian amounts are sometimes read 1000x too small, and 4 of the 7 planted three-way problems are not raised as differences. HTTP 429 rate limits push some runs onto the smaller fallback model, and those runs lose fields.

**Setup.** `scripts/eval/run_eval.py` posted each document to `/api/documents/analyze` the same way `seed_demo.seed_document` does, against my own server (`:8391`, fresh `VARELQ_DB`, hosted `nemotron-ocr-v2`, LLM `nemotron-3-super-120b-a12b`, `NIM_CONCURRENCY=2`, client concurrency 2, 240 s timeout). Receipts were posted as the invoice role only. Synthetic sets were posted with all three roles. `scripts/eval/score.py` scored the raw responses, and all numbers below are in `scripts/eval/results.json`.
- **Code evaluated:** `documents.py` sha256 `ed2af099f3c1…` and `server.py` `800f66188f7a…`, unchanged since commit `9cb23f9` "Accuracy quick wins" (14:41 UTC). HEAD was `80c2749` when I scored, and neither file changed after `9cb23f9`.
- **Two full passes:** run 1 (headline) and run 2 (repeat). The demo server on :8390 was not touched. The hosted OCR endpoint serves the same model as the L4 (the first spot check found identical text on 36/37 blocks).

### 5.1 Results per dataset (run 1 unless stated; 95% Wilson intervals in brackets)

| Dataset | n | Metric | Value | Basis |
|---|---|---|---|---|
| SROIE 2019 (MIT) | 20 receipts | Company = extracted supplier (token-sort ratio ≥ 0.9) | 14/20 = 70% (48–86%) | `NNN.json` company |
| | | Company, lenient (every ground-truth word present) | 16/20 = 80% (58–92%) | same |
| | | Total (numeric, ±0.01) | 18/20 = 90% (70–97%) | `NNN.json` total |
| | | Date | 0/20 (0–16%) | the response has no date field |
| | | Address | 0/20 (0–16%) | the response has no address field |
| | | Run 2: company / total | 12/20 = 60% (39–78%) / 16/20 = 80% (58–92%) | 2 of the 20 fell back to the small model after HTTP 429 and lost every field |
| | | OCR CER, all characters, case-insensitive | 10.2% (1110/10854) | box text `NNN.csv`, one-to-one line alignment |
| | | OCR CER, letters and digits, case-insensitive | 8.0% (696/8714) | same |
| | | OCR CER, all characters, case-sensitive | 34.0% (3692/10854) | inflated: SROIE box text is mostly upper case, OCR keeps mixed case |
| | 943 matched OCR blocks | Wrong when labelled "Verify" (< 0.80) | 56/85 = 66% (55–75%) | block ≠ its ground-truth line (case-insensitive) |
| | | Wrong when labelled "Check" (0.80–0.90) | 99/312 = 32% (27–37%) | same |
| | | Wrong with no label (≥ 0.90) | 55/546 = 10% (8–13%) | same |
| | | Wrong blocks that carry any label (recall) | 155/210 = 74% (68–79%) | same |
| | | Labelled blocks that are wrong (precision) | 155/397 = 39% (34–44%) | same |
| CORD v2 test (CC-BY-4.0) | 10 receipts | Total | 6/9 = 67% (35–88%) | `total_price`; receipt 009 has none |
| | | Tax | 2/4 = 50% (15–85%) | `tax_price` |
| | | Subtotal (net) | 3/8 = 38% (14–69%) | `subtotal_price` |
| | | Menu prices found among extracted line totals | 7/16 = 44% (23–67%) | `menu[].price` |
| | | Amounts read 1000x too small ("60.000" read as 60.0) | 4 values (receipts 000, 005) | Indonesian thousands separator |
| | | Run 2: total / menu prices | 4/9 = 44% (19–73%) / 3/16 = 19% (7–43%) | 5 of the 10 on the fallback model (HTTP 429) |
| Synthetic three-way (in-repo) | 7 planted problems in 7 sets | Raised as a difference | 3/7 = 43% (16–75%), same in both runs | `expected_findings` |
| | | Short delivery, over-invoicing, VAT miscalculation | 3/3 detected | `qty_received_vs_ordered`, `qty_invoiced_vs_ordered`, `tax_vs_rate` |
| | | Price mismatch (degraded JPEG) | missed | SKU column merged into the description, so no SKU matched the PO and cross-checks were skipped (a limitation says so) |
| | | Missing receiving line, duplicate line, currency mismatch | 0/3 as differences, 3/3 shown only as limitation text | no check produces a difference for these |
| | 3 clean controls | Zero differences | run 1 2/3, run 2 3/3; together 5/6 (44–97%) | |
| | 10 sets | False-positive differences | run 1: 6; run 2: 1 | see 5.2 |
| All | 40 requests per run | HTTP 200 | 40/40 in both runs; run 1 first attempt had 2 client timeouts at 240 s (SROIE 055, eval-clean-eur-4lines), both fine on retry | |
| | | OCR fallback used | 0/80 pages (0–5%) | `ocr_pages[].fallback_used`; all on the hosted endpoint |
| | | LLM fallback used (HTTP 429 on the primary model) | run 1 2/40 = 5% (1–17%); run 2 8/40 = 20% (11–35%) | response `fallback_used`, `model` |
| | | OCR latency p50 / p95 | 558 / 842 ms (n=40); run 2 540 / 696 ms | `latency_ms` |
| | | End-to-end latency p50 / p95 | 12.7 / 40.7 s; run 2 25.4 / 72.8 s | client wall time, includes rate-limit waits |
| | 40 documents in both runs | Identical OCR text between runs | 40/40 (91–100%) | block text |
| | | Identical key fields (supplier, total, net, VAT, item count) | 28/40 = 70% (55–82%) | 7 of the 12 changed documents used the fallback model in one of the runs |
| | | Identical set of differences | 32/40 = 80% (65–90%) | |

### 5.2 Notable errors

1. **Wrong supplier:**
   - SROIE 007: the handwritten customer name "tan chay yee" (line 1) was taken as the supplier instead of S.H.H. MOTOR. The total was not extracted either.
   - OCR misreads copied through: 031 "AEON" became "DEEN CO. (M) BHD", 043 "32 PUB" became "D0 PUB", 046 "PASAR MINI" became "PASAR NINE".
   - The remaining two misses (040 "THREE STOOGES BISTRO & CAFE" and 157 with a registration number) are fuller than the SROIE key and count as correct under the lenient rule.
2. **Wrong total:** SROIE 169 took "Cash RM30.30" (30.30) instead of the total RM29.30.
3. **Indonesian amounts:** CORD 000 and 005 read "60.000", "5.455" and "31.000" as decimals (60.0, 5.455, 31.0) instead of thousands. No check flags the currency or magnitude.
4. **Rounding false positive:** on the price-mismatch set, `tax_vs_rate` reports 354.635 against 354.64 as a difference in both runs. This is a 3-decimal TND amount compared at 2 decimals.
5. **Degraded clean set:** on eval-clean-eur-4lines (run 1), each line total was read as the unit price (18.40 instead of 460 × 18.40). That produced 4 false `line_qty_x_price` differences and 1 false `line_sum_vs_net`. Run 2 read the same image correctly.
6. **High-score OCR errors with no label** (55 blocks at ≥ 0.90), for example 037 postcode "81750" read as "B1750" (0.928), 031 "AMOUNT" read as "Awount" (0.923), "INCL" read as "Inci" (0.911).
7. **Rate-limit fallback:** runs that fell back to `nemotron-3.5-lightning-30b-a3b` after HTTP 429 often returned no fields at all (SROIE 061 and 178 in run 2 lost supplier, total, net and VAT). Nothing in the response warns the user beyond the model name.
8. **Latency:** run 1 needed 240 s or more for 2 documents on the first attempt, and run 2 p95 was 73 s, both driven by 429 retries under a 40 requests/minute limit shared by 2 concurrent clients.

### 5.3 What changed since the first spot check (sections 1–3)

- **Sample size:** 1 real receipt and 2 synthetic invoices before; 30 real receipts and 10 new synthetic sets now, each run twice.
- **Review labels:** the "Verify" band looked perfect before (4/4 blocks under 0.80 were wrong) and is now 56/85 (66%). The unlabelled band was 49/50 right before and is 491/546 (90%) right now. The labels are useful, but about 1 in 4 wrong lines carries no label.
- **Receipt OCR error rate:** letters and digits went from 1.9% on one receipt (against a hand-corrected truth) to 8.0% on 20 receipts (against the raw SROIE box text). The new number includes SROIE annotation errors, for example 004 "UPERATOR" where the OCR correctly read "OPERATOR".
- **Receipt fields:** totals were 1/1 right before and are 18/20 now. Supplier was wrong on the one receipt before and is right on 14/20 now.
- **Three-way checks:** the first check found 2/2 planted problems. The wider set shows that 3 kinds of problem (missing receiving line, duplicate line, currency mismatch) have no difference check at all, and that degraded scans can break SKU matching.
- **Invented net:** the quick-wins prompt change was meant to stop net being invented. It was not measured separately here, but CORD subtotals were still missing in 5/8 cases, so net is now missed rather than invented.
- **Rate limits** remain the main source of run-to-run variation (2/40 and 8/40 fallbacks).

### 5.4 Limitations

- **Small samples:** 20 SROIE, 10 CORD and 10 synthetic sets, with wide intervals (for example total 70–97%). The two runs use the same documents, so they measure repeatability, not new data.
- **SROIE ground truth has its own errors:** box text is mostly upper case, contains annotation typos, and uses a company string that is sometimes shorter than the printed name. The case-insensitive and lenient metrics are reported next to the strict ones.
- **OCR line alignment is approximate:** it is greedy one-to-one by similarity, so a split or merged line counts as errors. A block counts as right only if it equals or is part of its matched line.
- **CORD:** images come from the datasets-server at reduced size (for example 432x648), so OCR is harder than on the originals. Ground-truth amounts are strings normalised by `score.py`. The receipts have no supplier or date keys, so only amounts are scored.
- **Synthetic sets** come from the same generator the app was developed against, so the results are optimistic for clean images. Only 4 of the 10 are degraded, and the planted problems were designed by us.
- **Licences:** SROIE is MIT (repository licence in `public-data/sroie/LICENSE`). CORD is CC-BY-4.0 with attribution in `public-data/cord/LICENSE`. The synthetic sets contain no third-party data.
- **Not measured:** the self-hosted L4 endpoint, LLM calls without rate-limit pressure, and dates and addresses (no schema fields).
