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
| OCR | Latency | L4 268 ms (n=1); hosted 536–980 ms stored, 550–754 ms live (n=7) | 8 calls | latency_ms |
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
