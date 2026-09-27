# Live NVIDIA verification — 27 September 2026

Both API paths were called through the local VARELQ HTTP server with authenticated NVIDIA inference using `nvidia/nemotron-3-super-120b-a12b`. No result was substituted with a test fixture. Credentials were entered through the hidden launcher prompt, not written to project files.

## Document path

Source: public SROIE receipt transcription, repository `zzzDavid/ICDAR-2019-SROIE`, `data/box/000.csv`. Original data, MIT repository license and pinned-commit/hash manifest are in `public-data/sroie/`. The test removed the eight coordinate columns and preserved the text in original annotation order. It did not perform OCR or invent accompanying purchase documents.

Successful run: `88ab4d091fbd4140a5cdbace96f5f044`.

- Extracted reference: TD01167104.
- Extracted printed total: 9.0 RM.
- Quantity 1 × unit price 9.0 = line amount 9.0; deterministic check passed with source lines.
- Missing net/tax and unmatched order/receiving checks remained explicitly unavailable.
- Saved result and incomplete-check warnings verified in the browser.

This validates receipt-text ingestion, live extraction, source-location validation, arithmetic, persistence and rendering. It does not validate scanned PDFs, all document layouts or complete three-way reconciliation.

## Reliability path

Source: five complete recorded benchmark conversations from Microsoft AgentRx, pinned provenance in `public-data/agentrx/manifest.json`. Benchmark policies/conversations are input data; no ground-truth reward labels are sent to inference.

Successful final run: `56951eafc7674f089ab1963ba04c188e`.

The model grouped a missing required reminder to confirm all items before order modification across `agentrx-tau-3`, `agentrx-tau-4`, and `agentrx-tau-20`. Manual inspection confirmed that these runs requested transaction confirmation but did not include the specific all-items reminder required by their benchmark policy. This is a narrow policy-omission finding, not proof of the benchmark's overall failure cause.

An earlier model response incorrectly grouped order-status problems across tau-4 and tau-20. It is preserved with an explicit quality warning in the saved result. Valid trace IDs alone do not establish correct semantic analysis. The UI labels all groups as candidate findings requiring evidence review.

## Changes prompted by real testing

- Disabled internal reasoning for extraction; bounded it for reliability to leave room for the requested JSON output.
- Delimited trace evidence and repeated the analysis/output request after the recorded conversations to avoid continuing the conversations instead of analyzing them.
- Required numeric field values without unit text; retained explicit printed currency codes such as RM.
- Preserved failed attempts and the incorrect interpretation in history rather than silently replacing them.

Regression suite: 12 tests passed after the changes. These separate tests use isolated model responses and temporary storage; they are not runtime seed data.

The temporary token was shared in chat and should be revoked after this test session. Restarting VARELQ requires a key again. No GPU instance was provisioned.


## GPU OCR and redesign — 2026-09-27

Authenticated hosted NVIDIA nemotron-ocr-v2 processed the original public SROIE receipt-000.jpg, then Nemotron extracted fields and Python ran available arithmetic checks. Saved run: 9e6281287e8d4e33b79a8b92b7317cd8. Total RM 9.00 and 1 × 9.00 arithmetic were correct. OCR misread the supplier lettering and document reference (TD01167104 in the source, TDD1167714 in OCR). This is a successful integration test, not an accuracy certification. Geometry, detection scores and raw text are retained for review. No corrections were silently substituted.

16 automated checks pass, including PDF rasterization/page attribution, rejecting too many scan pages before any GPU request, blank OCR failure, and preventing Build credentials from being sent to custom endpoints. Scanned PDF plumbing was tested with an isolated OCR response; live GPU verification used the public JPEG.

Organization form saved successfully in the browser. Dark theme survived navigation/reload; light theme restored after testing. The prototype includes density, reduced motion and organization settings. These are local browser preferences, not multi-tenant authentication.

Dedicated Brev L4 deployment is prepared but not launched. Console quote: $1.07/hour running, $0.05/hour storage while stopped. Deployment needs user acceptance of cost and GCP data-sharing terms; NGC Catalog container entitlement is still unverified. Hosted GPU OCR is operational without this VM. Deployment files are in deploy/.
