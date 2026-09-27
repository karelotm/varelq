> ARCHIVED HANDOVER: describes the original seeded prototype. See README.md for the current live-only implementation and remaining limitations. Instructions and sample values below are historical context.

# VARELQ — Codex implementation handover

## Objective

The included frontend and `server.py` have two wired **NVIDIA NIM** paths: live document extraction and live agent failure grouping. The server-side key is not included; authenticated inference has not been tested in this workspace. The original dashboard and rule-based local reliability preview remain deterministic and are clearly labeled. Finish account configuration, test actual inference, and record a live demo.

### NVIDIA account and model verification — 27 September 2026

- The signed-in Brev workspace displayed **$100.00 balance, $0 usage, and no running environment**. This is Brev compute credit; it does not replace a Build API key for the hosted inference endpoint. No GPU was launched.
- The signed-in NVIDIA Build Playground for `nvidia/nemotron-3-super-120b-a12b` was usable after the account owner accepted the API Trial Terms.
- A synthetic invoice/order/receipt prompt returned valid JSON with all expected fields and exact sample values. A second synthetic agent-trace prompt returned two distinct recurring issues, each citing the correct pair of trace IDs and proposing a fix.
- **These were Playground tests, not tests of `server.py` against the authenticated API.** Never present the app itself as live-verified until `NVIDIA_API_KEY` is set in the server environment and both live buttons succeed.
- The browser session's API key was not accessed or copied. Create/configure the key through a secure account workflow; never paste it into a chat message or commit it to this bundle.
- For local use, `python3 run.py` collects the key through a hidden terminal prompt and keeps it only in process memory. For hosted use, set `NVIDIA_API_KEY` as a server secret.

## Product and brand

- Name: **VARELQ** (working name; web screening found no obvious matching AI software product, but trademark/domain clearance is still required).
- Position: document reconciliation and accountable operations decisions for SMEs.
- Brand: deep forest `#14221b`, lime `#b7f15b`, off-white `#f4f6f3`. The V mark uses a horizontal crossbar to suggest reconciliation of two sources. The editable vector is `dist/assets/logo.svg`.
- Main routes (hash navigation): `#overview`, `#investigations`, `#documents`, `#suppliers`, `#inventory`, `#agents`, `#reliability`.
- Entry point: `dist/index.html`. Styling: `dist/assets/style.css`. Behavior: `dist/assets/app.js`. Local API and static server: `server.py`.

## What already works

- Responsive navigation and six connected screens.
- Five-stage animated investigation sequence (a demonstration timer, not backend events).
- Upload picker and drag/drop list of local filenames; files are **not read or sent**.
- Evidence cards, supplier and inventory views, drafted clarification email with copy button.
- Approve/reject controls modify only page memory; no financial action occurs.
- **Agent Reliability** imports JSON or JSONL conversation/tool traces in the browser (up to 2 MB, 5,000 rows), groups three known failure patterns through transparent local rules, ranks them by severity × observed frequency, and displays original trace evidence and suggested fixes. A clean tool call stays visible in the trace table. This is working rule-based analysis, not NVIDIA inference. The bundled `sample-traces.jsonl` is an importable example.
- **Live action:** `Analyze with NVIDIA` sends up to 500 imported traces to `POST /api/agent-failures`. NIM groups repeated failures; the backend keeps only groups with at least two distinct IDs from the submitted input and returns the original trace evidence. Live failures display errors rather than sample results.
- **Live action:** the Documents page accepts three PDF/CSV/TXT sources, sends them to `POST /api/documents/analyze`, uses NIM to extract fields, performs deterministic price/tax/quantity checks and renders a distinct live result. Importable text fixtures are in `sample-documents/`. Scanned PDFs are currently unsupported.

## SupplyzPro challenge — second core journey

The official **“Find the Hidden Failures”** brief asks for recurring failures in AI-agent conversations and tool calls, grouped into related issues and prioritized with clear evidence. It is **not** an invoice anomaly challenge. The partner award is TND 1,000 and remaining eligibility details are organizer-dependent. VARELQ's document investigation alone does not satisfy it; the Agent Reliability route is the relevant submission experience.

For a credible final version, instrument VARELQ's own agents and ingest their execution traces (plus an explicitly labeled seeded test set with repeated failures):

1. Capture one `trace_id` and timestamps across user message, model response, tool call, tool result, extracted fields and final answer. Strip credentials, personal data and document bodies from traces by default.
2. Normalize provider/tool events to the contract below. Detect failures with deterministic rules: timeout followed by an unsupported success claim; extraction schema error followed by a tax approval; missing supplier lookup followed by a verified-bank claim. Mark *observed tool error* separately from *inferred agent misbehavior*.
3. Use a NVIDIA Nemotron model via NIM to propose semantic grouping of novel failures and a short explanation. Require every proposed group to cite existing trace IDs and exact tool/result snippets. Revalidate IDs against the input; reject invented evidence.
4. Rank issues with an explicit score combining severity, repeat count and business impact. Show the formula and allow a human to inspect and override priority. Avoid numeric “confidence” unless calibrated.
5. Show before/after: run an unguarded agent on a test query, display the failed trace, add a guard/fallback, rerun the same query, and show the corrected trace. This is the strongest demo path for the SupplyzPro award.

### Trace import contract (already supported by the browser prototype)

An array in `.json`, or one object per line in `.jsonl`. Required strings: `trace_id`, `tool`, `status`, `message`, `agent_reply`; optional `timestamp`, `user_message`.

```json
{"trace_id":"TR-1041","timestamp":"2026-09-27T09:12:10Z","tool":"inventory.lookup","status":"timeout","message":"Lookup timed out after 10s","user_message":"Are 15 units available?","agent_reply":"Yes, all 15 are available."}
```

The current browser rules recognize `inventory.lookup` + `timeout` + unsupported availability claim, `invoice.extract` + `schema_error` + unverified approval, and `supplier.lookup` + `no_result` + unsupported verification claim. All other trace rows are displayed but not grouped. This makes the behavior inspectable; it does not claim comprehensive detection.

The current live backend exposes `POST /api/agent-failures` and returns analysis in one call. For durable use, add stored runs, paginated issues and evidence endpoints. Connect NeMo Agent Toolkit telemetry where practical. Keep the input schema versioned and independently store raw event identifiers. The UI must distinguish actual recorded runs from seeded demonstration data.

## Correct sample case — preserve these values

| Source | Values |
| --- | --- |
| PO-2026-443 | 15 units × 2,500 MAD = 37,500 MAD net; 20% VAT = 7,500 MAD; total 45,000 MAD |
| INV-2026-0917 | 15 units × 2,650 MAD = 39,750 MAD net; stated VAT 8,100 MAD; total 47,850 MAD |
| REC-2026-0918 | 12 units received, 3 outstanding |
| Finding A | Unit price difference: 150 MAD × 15 = 2,250 MAD |
| Finding B | Expected VAT on invoiced net: 7,950 MAD, stated VAT: 8,100 MAD; difference 150 MAD |
| Finding C | 3 outstanding units; reference order value 3 × 2,500 = 7,500 MAD |

Do not add these findings into one “exposure” total: the price and delivery checks can overlap economically. The 47,850 MAD is **payment under review**, not a loss estimate. The UI intentionally says so.

## NVIDIA-first implementation

The participant reports access to NVIDIA resources and **$1,000 Brev credit**. Use it for a real integration and a reliable demo; verify available credit, model quotas, GPU stock, and rules in the participant's account. Never put the API key in browser code.

1. **NVIDIA Build / NIM**: `server.py` already makes server-side chat completion calls via `https://integrate.api.nvidia.com/v1/chat/completions` using `Authorization: Bearer $NVIDIA_API_KEY`. The default `nvidia/nemotron-3-super-120b-a12b` is shown with a free prototype endpoint on NVIDIA Build as of this handover; confirm model access in the participant account. Set `NVIDIA_MODEL` and optionally `NVIDIA_BASE_URL` for another hosted/self-hosted NIM. Test a real strict JSON response before the demo.
2. **Document ingestion**: `server.py` extracts text from digital PDFs via `pypdf` and CSV/TXT via UTF-8 decoding, then asks NIM for structured fields. For scans or mixed-layout PDFs, integrate **NeMo Retriever** with `pdfium_hybrid` or `nemotron_parse`, depending on installed version and endpoint availability. Preserve page/row and original text snippets with every extracted field. This source-location evidence is still missing in the live path.
3. **Brev**: create an appropriately sized instance if self-hosting an OCR/model NIM or if a GPU workload is actually needed. Build/integration using NVIDIA's hosted inference API may not need a GPU VM. Use Brev for reproducible environment, demo deployment, or self-hosted NIM only when it improves the live demo. Check billing/credits in the Brev console and stop the instance after the event.
4. **Agent orchestration**: if setup time permits, use **NeMo Agent Toolkit** to define document, finance, procurement, inventory, and recommendation stages and export traces. For today's golden path, a deterministic backend pipeline with NIM calls is acceptable and easier to verify. Never label hardcoded demo steps as live agents.
5. **Responsible operation**: calculate arithmetic and cross-document differences in deterministic code; use the LLM for extraction from messy input, explanation, and draft generation. Keep uncertainty, missing evidence, citations, and human approval in the response. Never send an email or execute payment without a separate explicit approval and connector authorization.

### Suggested API contract

Currently implemented: `POST /api/documents/analyze` as `multipart/form-data` with `invoice`, `purchase_order`, `receiving_record` (text-based PDF/CSV/TXT). It returns the analysis synchronously. For asynchronous work, evolve it into `POST /api/investigations`, returning `{ investigationId, status }`.

`GET /api/investigations/:id/events` as SSE (or polling) with `{ stage, status, timestamp, message }`. Replace the frontend timer in `run()` with this event stream.

`GET /api/investigations/:id` returns:

```json
{
  "id": "INV-2026-0917",
  "supplier": "Atlas Equipment SARL",
  "currency": "MAD",
  "invoiceTotal": 47850,
  "findings": [
    {
      "type": "price_difference",
      "amount": 2250,
      "calculation": "15 * (2650 - 2500)",
      "evidence": [
        { "document": "INV-2026-0917", "field": "unit_price", "value": 2650, "location": "page 1" },
        { "document": "PO-2026-443", "field": "unit_price", "value": 2500, "location": "page 1" }
      ]
    }
  ],
  "recommendation": "Hold payment and request clarification",
  "requiresHumanApproval": true
}
```

`POST /api/investigations/:id/draft` returns editable subject/body with source-linked claims. `POST /api/investigations/:id/decision` records review status and reviewer identity; it must not trigger payment. If the app remains local during judging, a visible “demo dataset” toggle should load a fixture and a separate “analyze uploaded files” path should perform real inference.

## Build order for the next Codex session

1. Configure `NVIDIA_API_KEY` as a server secret and verify a real response from the default model; switch `NVIDIA_MODEL` if your account uses another available endpoint.
2. Run both live paths with `sample-documents/` and `sample-traces.jsonl`; correct parsing prompts if your model's output differs. The current sample files are TXT/TXT/CSV, not PDFs.
3. Add source locations to extracted fields, scanned-document OCR, and a clean document case. Keep arithmetic deterministic.
4. Instrument VARELQ agent calls with trace IDs, then feed the captured traces into the reliability view. Demonstrate a failed run and a corrected rerun. Seeded sample logs must stay labeled as samples.
5. Add asynchronous progress and durable storage if time allows. The animated sample flow is still a demonstration timer; live analysis shows a busy state and final result.
6. Add missing-document, malformed-output, timeout and low-confidence handling. Verify desktop and phone.
7. Record the 90-second demo from the authenticated NVIDIA path, and prepare the project card. For SupplyzPro, allocate demo time to the failure groups and exact trace evidence.

## Technology suggestion

The current server uses Python's standard-library HTTP server and optional `pypdf` for a fast local prototype. It binds to `127.0.0.1` and has no authentication or persistent storage. Put it behind an authenticated HTTPS service before internet exposure. Host on Brev if a GPU NIM is used, otherwise any stable HTTPS host for API-bound NIM calls. If migrating the UI to Next.js or FastAPI later, preserve the visual system and routes. Never expose uploaded documents or API keys through public static files.

## Official references

- NVIDIA NIM LLM API: https://docs.api.nvidia.com/nim/reference/llm-apis
- NVIDIA NeMo Retriever extraction: https://docs.nvidia.com/nemo/retriever/latest/extraction/overview/
- NVIDIA NeMo Agent Toolkit tracing: https://docs.nvidia.com/nemo/agent-toolkit/latest/run-workflows/observe/observe.html
- NVIDIA Brev instance overview: https://docs.nvidia.com/brev/concepts/gpu-instances
- NVIDIA Brev billing/credits console: https://docs.nvidia.com/brev/guides/console-reference
- Official SupplyzPro award brief: https://hackathon.gomycode.com/#prizes
