# VARELQ — local live workspace

This version supersedes the original frontend handover. The running app contains no seeded invoice, supplier, inventory, agent, or reliability results. It starts empty and displays saved real requests. The old sample invoice and trace files have been removed; the original ZIP remains untouched.

## Start on Windows

In PowerShell run this command, not the contents of the CMD file:

```powershell
& "C:\Users\PC\OneDrive\Documents\ChatGPT\New project\varelq\Launch-Live.cmd"
```

Enter NVIDIA_API_KEY at the hidden terminal prompt. Open http://127.0.0.1:8081/ and keep the terminal open. Alternatively, from this folder run `$env:PORT = '8081'` and then `python .\run.py`. A PowerShell launcher, Launch-Live.ps1, is also provided. Restart the launcher after backend edits. The key stays in the process environment, never in project files. Requires Python 3.12 and the packages in requirements.txt (`python -m pip install -r requirements.txt`).

The unauthenticated development preview runs on port 8080 and cannot make NVIDIA calls. The two ports use the same local database.

## Actual workflows

- Documents: upload an invoice, optionally its actual order and receiving record. NVIDIA extracts line items and source locations. Python checks finite numeric values, arithmetic, printed tax rate, matching order references, unique SKUs, and explicit currencies. Missing information yields skipped checks, never invented values. Original extracted text and location references are inspectable.
- Investigations: saved results, per-check evidence, incomplete-check warnings, JSON export, editable clarification text, and persisted human review status. Review actions do not release payments or send emails.
- Reliability: import JSON/JSONL, load recorded VARELQ execution metadata, or explicitly load the public AgentRx benchmark. Analysis occurs only on request through NVIDIA. Duplicate trace IDs are rejected; invented citations invalidate the group; recurrence requires at least two independent runs. Priority is severity weight times independent affected runs. Suggestions are not presented as executed fixes.
- Overview, suppliers, receiving and execution history derive from stored analyses. There are no timer-based agents or fabricated KPI values.

Results and extracted source text are saved in data/varelq.sqlite3 (git-ignored, outside the static web directory). Document binaries and API keys are not stored. Saved reports contain the uploaded data; this is a local single-user prototype without authentication. Do not expose its server publicly.

## Public test data

public-data/agentrx/ contains Microsoft's AgentRx tau retail failed trajectories, repository MIT license, and a provenance manifest with pinned commit and SHA-256. These are recorded executions in a simulated retail benchmark, not production business records. The loader preserves complete conversation/tool events, excludes ground-truth labels from inference, and currently selects the first five full trajectories within its input budget. All 29 source trajectories remain in the original file. No failure groups are precomputed or seeded.

Source: https://github.com/microsoft/AgentRx

Public invoices without matching purchase orders and receipts cannot establish a three-way reconciliation test. Use your actual matched records for that path. The app can analyze an invoice alone and explicitly report unavailable matching checks.

## Verification and limits

Run `python -m unittest discover -s . -p 'test_*.py' -v` and `node --check dist/assets/app.js`.

Unit/integration checks use isolated model responses and a temporary database, never app seed data. They do not prove NVIDIA model quality. Authenticated NVIDIA calls were verified for document extraction on a public SROIE receipt transcription and reliability analysis on five public AgentRx runs. See LIVE-VERIFICATION.md for results and limits. A full matched invoice/order/receipt set still needs live verification. The browser has verified empty state, public benchmark loading, and visible missing-key failure without fallback results.

Images and scanned PDF pages use NVIDIA hosted GPU OCR, retaining detection geometry and scores for review. Configure a dedicated GPU using deploy/README.md. PDF limits are 30 pages, at most 5 requiring OCR, 60,000 text characters per document; request body limit is 12 MB. No silent content truncation. Trace batches support 1–500 unique IDs and 240,000 JSON characters. Source line membership is validated, but AI interpretation of those lines still requires human review. Discounts, shipping, multiple tax rates, returns/negative amounts, and line-total aggregation need further support. Numeric comparisons currently use a half-cent tolerance; quantity checks are exact. Missing SKU or reference data prevents cross-document checks rather than guessing a match. Stored-run listing is limited to the latest 100 runs. The live failure → automatic fix → rerun workflow is not implemented; suggested fixes are advisory.
