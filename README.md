# VARELQ

VARELQ finds the hidden failures in AI operations agents. It pins each failure to the exact step and tool call, groups the recurring patterns, ranks them with evidence, and tests the fix twice: first by replaying a guard over the recorded runs, then with a live guarded rerun.

Built for the GOMYCODE × NVIDIA "Come Build with AI" hackathon, 27 September 2026. The submission kit is in [SUBMISSION.md](SUBMISSION.md), and the video script is in [DEMO.md](DEMO.md).

> This is a local, single-user prototype with no authentication. The server binds to `127.0.0.1` only. Do not expose it publicly.
>
> The public demo for judges runs on a Brev L4 behind an access-code gate with rate limits (`deploy/gate.py`) and a Cloudflare quick tunnel; see [deploy/HOSTING.md](deploy/HOSTING.md). The URL and access code are shared in the submission form, not in this repo.

## What it does

| Screen | Route | What you see |
|---|---|---|
| Findings | `#reliability` | 29 failed τ-bench retail runs (via Microsoft AgentRx) checked by deterministic rules R1–R3. Each group shows its runs affected, severity, an inline priority formula (for example "Critical 3 × 12 runs = 36"), the policy clause it breaks, an explanation written by Nemotron (tagged "Model", or "Template" when the model call fails), a held-out evaluation against the benchmark's reference actions, and a deterministic replay of the guard over the same recorded runs, including the reference-correct writes it would wrongly block |
| Trace | `#reliability/trace/<id>` | The full conversation and tool-call timeline, scrolled to the flagged step, with the flag reason and the policy clause highlighted |
| Guard lab | `#lab` | A live Nemotron accounts-payable agent on **synthetic** scenarios: S0 clean control, S1 receiving-record timeout, S3 instruction injected in the invoice, S4 receiving-record timeout with payment pressure. It runs baseline and guarded ×5 each. The `payment_precondition` guard blocks `approve_payment` at dispatch and escalates to a human; it never auto-approves |
| Overview, Documents, Case | `#overview`, `#documents`, `#cases/<id>` | Three-way invoice / purchase order / receiving record reconciliation. OCR by NVIDIA `nemotron-ocr-v2`, field extraction by Nemotron, and deterministic Python checks, each with its evidence box on the page image |
| Settings | `#settings` | Theme, density and motion; the models and endpoints in use; OCR mode; a timestamped `nvidia-smi` capture from the Brev L4, shown only when `deploy/gpu-capture.json` exists (it is not in the repo yet, so Settings shows no capture) |

Rules, arithmetic, evaluation and replay are deterministic code. The model explains findings and drives the lab agent. It never decides what is flagged.

## Run it

Requirements: Python 3.12 and an NVIDIA Build API key (https://build.nvidia.com). Without a key, the deterministic parts (rules, evaluation, replay, checks) still run, and model text falls back to templates, tagged "Template".

```bash
git clone https://github.com/karelotm/varelq.git
cd varelq
python -m pip install -r requirements.txt
```

PowerShell:
```powershell
$env:NVIDIA_API_KEY = "<your key>"      # keep it in the process environment; never commit it
$env:PORT = "8080"
python server.py
```

Bash:
```bash
NVIDIA_API_KEY="<your key>" PORT=8080 python server.py
```

Open http://127.0.0.1:8080/. `python run.py` does the same but asks for the key at a hidden prompt.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NVIDIA_API_KEY` | none | NVIDIA Build key, read server-side only |
| `PORT` | `8080` | HTTP port (bound to 127.0.0.1) |
| `VARELQ_DB` | `data/varelq.sqlite3` | SQLite file for saved runs (git-ignored) |
| `NVIDIA_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | Explanation and extraction model |
| `AGENT_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | Guard lab agent model |
| `NVIDIA_EMBED_MODEL` | `nvidia/nemotron-3-embed-1b` | Embedding model (group cohesion only; groups are not formed by embeddings) |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | Chat completions endpoint |
| `NVIDIA_OCR_URL` | hosted `ai.api.nvidia.com` OCR | Set to a self-hosted NIM, for example `http://127.0.0.1:8000/v1/ocr` |
| `NVIDIA_OCR_LABEL` | none | Label shown in the UI, for example `NIM on Brev L4` |
| `NVIDIA_OCR_FALLBACK` | none | `hosted`: if the self-hosted OCR fails or times out, retry once on the hosted endpoint and mark the page `fallback_used` |
| `NVIDIA_RPM_LIMIT` | `40` | Client-side requests-per-minute ceiling for the Build key; calls wait (at most `NVIDIA_RPM_MAX_WAIT_S`, default 20 s) instead of firing into HTTP 429. `0` disables |
| `NIM_FALLBACK_MODEL` | `nvidia/nemotron-3.5-lightning-30b-a3b` | When the requested chat model exhausts its retries on 429/5xx/timeout (never on 400 or invalid JSON), the request is sent once to this model. Runs record the model that actually answered plus `requested_model`, `fallback_used`, `fallback_reason`. Empty disables |

`GET /api/usage` reports process-wide NVIDIA usage (per model: requests, successes, failures, attempts, retries by status, tokens, p50/p95 latency; rolling 60 s count against `NVIDIA_RPM_LIMIT`; fallback counts), a summary of the last 20 OCR calls, and live GPU metrics. Live GPU metrics (`live` in `/api/gpu/status`, `gpu` in `/api/usage`) are read from the self-hosted NIM's `GET /v1/metrics` (Prometheus text, 2 s timeout, cached 5 s), only when `NVIDIA_OCR_URL` points at a loopback or private address; otherwise they report `{"available": false, "reason": ...}`.

### Self-hosted OCR on Brev (optional)

During the event, the OCR NIM `nvcr.io/nim/nvidia/nemotron-ocr-v2:2.0` was deployed on a Brev L4 instance, next to the public demo app, which reaches it at `http://127.0.0.1:8000/v1/ocr` on the VM with hosted fallback (`deploy/start-app.sh`). Language-model calls go to hosted NVIDIA Build. App inference through the L4 NIM was verified at 13:59 UTC on 27 Sep: run `be1bba179ec54a7f96494e14da4cc5af` through the public app, `endpoint_kind: self-hosted`, 458 ms, `fallback_used: false` (see the Brev section of [SUBMISSION.md](SUBMISSION.md)). The local demo-DB runs used the hosted endpoint. See [deploy/README.md](deploy/README.md) and `deploy/start-ocr.sh`. Judges do not need this: without `NVIDIA_OCR_URL`, OCR uses the hosted NVIDIA endpoint.

## Verify

```bash
python -m unittest discover -s . -p "test_*.py" -v
python -c "import server, nim, reliability, agent_lab, guards, tracing, documents, ocr, gpu, samples"
```

Test count at commit `fe2bb05`: 115, all passing. Unit tests use injected fake model responses and temporary databases, never demo data. They do not measure model quality. The live numbers and their run IDs are in the Reliability section of [SUBMISSION.md](SUBMISSION.md) and in [LIVE-VERIFICATION.md](LIVE-VERIFICATION.md).

## Data

| Data | Source | Licence | Nature |
|---|---|---|---|
| `public-data/agentrx/tau_dataset_failed.json` | τ-bench retail trajectories (© 2024 Sierra, https://github.com/sierra-research/tau-bench), republished by Microsoft AgentRx at commit `7a18c79` | MIT (both) | 29 recorded failed runs of an agent in a simulated retail benchmark; users are simulated. No real customer data |
| `public-data/sroie/` | ICDAR 2019 SROIE receipt 000 via `zzzDavid/ICDAR-2019-SROIE`, commit `27be427` | Repository MIT licence; the original competition dataset terms may also apply | One public receipt image and transcription |
| `sample-documents/three-way/` | Generated by `sample-documents/generate.py` | Project | Fictional invoice, PO and receiving records |
| `lab_data/` | Written for the guard lab | Project | Fictional AP scenarios |

The benchmark's reference actions (`info`, `reward`) are used only for held-out evaluation. They are never sent to the model.

## Security

- The API key is read from the environment only. It is never written to the database, traces, logs or `dist/`.
- The server binds to `127.0.0.1`, checks the `Host` header on every request and the `Origin` on POST, and sends no CORS headers.
- Uploaded document binaries are not stored. Sample files are served only from the manifest allow-list.
- Saved results stay in the local SQLite file, which is git-ignored.

## Layout

| Path | Contents |
|---|---|
| `server.py`, `nim.py`, `storage.py`, `run.py` | Standard-library HTTP server, NVIDIA client (JSON mode, retries with backoff, usage metadata), SQLite storage |
| `reliability.py`, `reliability_rules.md` | Rules R1–R3, policy clauses, held-out evaluation, counterfactual replay, model explanations |
| `agent_lab.py`, `guards.py`, `tracing.py`, `lab_data/` | Guard lab agent, the `payment_precondition` guard, span tracing |
| `documents.py`, `ocr.py`, `samples.py`, `gpu.py` | Reconciliation checks, OCR with fallback, sample manifest, GPU status |
| `dist/` | Frontend: native ES modules, no build step, self-hosted IBM Plex, Lucide icons |
| `deploy/` | Brev OCR NIM start script and notes |

`HANDOVER.md` is the archived handover from the pre-event baseline. It describes that earlier version, not this one.
