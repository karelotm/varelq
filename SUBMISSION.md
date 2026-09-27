# VARELQ: submission kit

GOMYCODE × NVIDIA "Come Build with AI", 27 September 2026. Deadline 17:30 Tunis; our target is 17:00 Tunis.

> **Teardown after the event (the user does this; agents may not):**
> 1. After 19:45 Tunis: `docker exec varelq-brev-client ssh varelq-ocr 'docker rm -f varelq-ocr'`
> 2. `docker exec varelq-brev-client brev stop varelq-ocr`, or delete the instance in the Brev console.
> 3. Revoke the temporary NVIDIA key at build.nvidia.com.

**How to use this file.** Each block marked *form box* is pasted as-is into the form and is under 500 characters. Numbers come from the demo DB (reliability report `4c29b27e491b4451ac6128bfafef8228`, the lab batches in section 4) or from an earlier batch today that is labelled as such; each has a run or batch ID. `TODO {…}` marks only what the repo cannot know: team, video and briefing items. Delete this paragraph before sharing the file.

---

## 1. Project card

**Name:** VARELQ

**One-line story** *(form box)*:
> VARELQ finds the hidden failures in AI operations agents: it pins each failure to the exact step and tool call, groups the recurring patterns, ranks them with evidence, and proves the fix, first by replaying a guard over the recorded runs and then with a live guarded rerun.

**Team:** TODO {team name and members, exactly as in the Final Team Confirmation; lead email must match}

**Tools** *(form box)*:
> NVIDIA Nemotron 3 Super 120B (NVIDIA Build API) for finding explanations and the guard-lab agent; NVIDIA nemotron-ocr-v2 as a NIM on a Brev L4 behind the public demo (hosted fallback); Python 3.12 standard library + SQLite; vanilla JS ES modules; IBM Plex, Lucide. Built with Claude Code (multi-agent) today on a Codex-built baseline from before the event.

**Next step** *(form box)*:
> Run VARELQ on SupplyzPro's own agent logs: write a rule pack for their procurement and support policies, replay candidate guards over their recorded runs, and ship the guard with the best trade-off between intercepted failures and false blocks, measured before it goes live.

**Links:**
- Video (90 s): TODO {video URL, following the briefing's hosting rule}
- Repo: https://github.com/karelotm/varelq (public)
- Live demo: hosted on the Brev L4 behind an access code; the URL and code are given in the form, not in this repo
- Run instructions: README.md, "Run it"

### Award selection

**Primary (dropdown):** SupplyzPro Smart Operations Award. TODO: confirm at the briefing that it is not Tunisia-only for our country; if it is, the primary becomes Artefact Data & AI.

**Secondary (checkboxes), one line each** *(form boxes)*:
- **SupplyzPro** (if not primary): "Step-level detection in conversations and tool calls, groups tied to rule IDs, an inline priority formula, evidence one click away, and a replay proof that reports its own false blocks."
- **Thunders Engineering Excellence:** "Tested and measured: 115 automated tests; 5/5 live analyses succeeded in an earlier batch today with latency and retries recorded (13 HTTP 429s, one 503); rate-limited lab runs were recorded as errors, not hidden, and calls are now paced; every number tied to a run ID."
- **Artefact Data & AI:** "Recorded agent runs become prioritised findings, scored against held-out benchmark reference actions (hits and false positives), with replay rates that report their own false blocks and baseline-vs-guarded lab rates."
- **Guepard AI Automation:** "A guarded agent workflow: the payment guard blocks unsafe approvals at dispatch and escalates to a human; it never auto-approves."
- **Yassir:** tick only if the team is in Morocco and the brief fits after reading it. Otherwise skip.
- Do not tick Kredete.

---

## 2. Problem, user and proof

**Problem** *(form box)*:
> Ops teams hand refunds, cancellations and payments to AI agents. When an agent breaks policy, the failure is buried in hundreds of runs: nobody sees which step did it, which failures recur, or which fix to ship first.

**User:** the owner of an ops agent, for example a support or procurement agent lead, who has hundreds of recorded runs and no ranked list of what to fix.

**Product** *(form box)*:
> Deterministic rules check every step and tool call of recorded agent runs. Findings are grouped by rule, ranked by severity × runs affected, and linked to the exact step and policy clause. Nemotron explains each group. A replay shows what a guard would have blocked on the same runs, including wrong blocks. A live lab tests the guard on a Nemotron agent.

**Proof, on 29 failed τ-bench retail runs** *(form box; from the seeded report `4c29b27e491b4451ac6128bfafef8228`)*:
> R1 "write without explicit confirmation" affects 12 runs. Flagged 14/29 runs; a flagged step hits the divergent write in 9/24 divergent runs; 3 flagged runs match the reference. Replay: blocks 22/58 writes, intercepts 9/24 divergent runs, wrongly blocks 9 reference-correct writes. R1 hand-labelled precision 5/10.

The seeded report confirms the planning pre-check: R1 fires in 12 runs (22 occurrences) and blocks 22 of 58 writes; 24 runs are divergent; R1 alone would block 9 reference-correct writes (of 33).

---

## 3. AI and tool disclosure

### Models and APIs

| Model | Endpoint | Purpose |
|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b` | NVIDIA Build, `https://integrate.api.nvidia.com/v1/chat/completions` (hosted) | One explanation and fix per finding group (JSON mode, thinking off). Tagged "Model"; on failure, a template tagged "Template" is used. Also extracts invoice fields |
| `nvidia/nemotron-3-super-120b-a12b` | Same | The guard-lab AP agent (JSON-action protocol, temperature 0.7, seed = run index, at most 8 turns) |
| `nvidia/nemotron-ocr-v2` | Self-hosted NIM `nvcr.io/nim/nvidia/nemotron-ocr-v2:2.0` on the Brev L4 next to the public demo app (`http://127.0.0.1:8000/v1/ocr` on the VM), verified by run `be1bba179ec54a7f96494e14da4cc5af`; fallback: hosted `https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2`, which the local demo-DB runs used | OCR of invoice images, with line boxes. Each page records `endpoint_kind`, `latency_ms` and `fallback_used` |
| `nvidia/nemotron-3-embed-1b` | NVIDIA Build (hosted) | A cohesion score per group ("embedding cosine"; R1 mean pairwise cosine 0.554 over 22 items in report `4c29b27e…`). Groups are formed by rules, not by embeddings |

**What decides and what does not:** detection (rules R1–R3), priority, evaluation, replay, the lab's safety oracle and the invoice checks are deterministic Python. The model explains findings and acts as the lab agent. It never decides what is flagged.

**AI disclosure** *(form box)*:
> Models: Nemotron 3 Super 120B (NVIDIA Build) explains finding groups and runs the lab agent; nemotron-ocr-v2, a NIM on a Brev L4 (hosted fallback), reads invoices. Detection, ranking, evaluation and replay are deterministic code; model text is tagged. Data: τ-bench via AgentRx (MIT), one SROIE receipt, synthetic lab and invoice data. Code: Codex baseline before the event; Claude Code multi-agent build today.

### Datasets and licences

| Data | Source | Licence | Notes |
|---|---|---|---|
| τ-bench retail failed trajectories (29 runs) | τ-bench © 2024 Sierra (https://github.com/sierra-research/tau-bench), republished by Microsoft AgentRx: https://github.com/microsoft/AgentRx/blob/7a18c79708e7671be15124460f4f7296107c2a55/data/tau_retail/tau_dataset_failed.json | MIT (τ-bench) and MIT (AgentRx) | Commit `7a18c79708e7671be15124460f4f7296107c2a55`, SHA-256 `17f8b335…5d717` in `public-data/agentrx/manifest.json`. Simulated users; no real customers. `info` and `reward` are held out and never sent to the model |
| SROIE receipt 000 | ICDAR 2019 SROIE via https://github.com/zzzDavid/ICDAR-2019-SROIE, commit `27be4271b251c256f695acbade9a801bffe85994` | Repository MIT licence (© 2019 Niansong Zhang, Songyi Yang, Shegjie Xiu); the original competition dataset's terms may also apply | One public receipt image and transcription, hashes in `public-data/sroie/manifest.json` |
| Three-way invoice samples | `sample-documents/generate.py` (Pillow) | Project | Synthetic: fictional supplier, invoice INV-0142/0143, PO-7781/7782, GRN-7781/7782 |
| Guard-lab scenarios S0, S1, S3, S4 | `lab_data/` | Project | Synthetic |

### Generated and third-party assets

- IBM Plex Sans and Plex Mono, self-hosted woff2, SIL Open Font Licence (`dist/assets/fonts/OFL.txt`).
- Lucide icon paths, ISC licence.
- The VARELQ logo (`dist/assets/logo.svg`) was made in the pre-event baseline.
- No generated images, voices or stock media. TODO: update if the video uses generated voice-over or music.

### Stack and access constraints

- Python 3.12 standard-library HTTP server, SQLite, `pypdf`, `pypdfium2`, Pillow. Frontend: native ES modules, no build step, no framework.
- Access constraints: a free NVIDIA Build key is needed for model text and hosted OCR. Without a key, rules, evaluation, replay and checks still run, and explanations fall back to templates. The Brev OCR NIM is optional.
- The app is a single-user prototype with no authentication of its own. It binds to 127.0.0.1.
- Public demo: the app and the OCR NIM run on the Brev L4; visitors reach the app through an access-code gate with rate limits (`deploy/gate.py`) and a Cloudflare quick tunnel. Model calls go to hosted NVIDIA Build. The URL and access code are shared in the form only.

### How the code was built (originality)

**Before the event (Codex).** Baseline commit `a8ed47b`, "Baseline: VARELQ as delivered by Codex", is timestamped 12:02 UTC = **13:02 Tunis today**, but the code in it was written by OpenAI Codex **before** the event and committed today as a starting point. It contained:
- the standard-library server with document upload, Nemotron field extraction and deterministic arithmetic/cross-document checks;
- hosted `nemotron-ocr-v2` OCR for images and scanned PDF pages;
- an earlier reliability path in which the model grouped failures over 5 AgentRx runs (`/api/agent-failures`);
- SQLite storage, the launchers, the earlier single-file frontend and style, the logo, the public-data manifests and a prepared, not launched, Brev deployment script.

**Today (Claude Code, multi-agent, from 13:50 Tunis).** Claude Code (Anthropic) ran as a lead agent plus parallel stream agents, each owning separate files, under the user's direction. Built today:
- `nim.py`: NVIDIA client with JSON repair, retries with backoff and usage/retry metadata;
- `reliability.py`: deterministic rules R1–R3, step-level flags with reasons, policy clauses with offsets, held-out evaluation, counterfactual replay, per-group model explanations;
- `agent_lab.py`, `guards.py`, `tracing.py`: the guard lab, the `payment_precondition` guard, span tracing;
- `documents.reconcile()` with structured checks and OCR line boxes, `samples.py`, `gpu.py`, the synthetic three-way samples;
- the Brev L4 deployment: the OCR NIM plus the public demo app behind an access-code gate and a Cloudflare quick tunnel (app OCR through the L4 NIM verified, run `be1bba179ec54a7f96494e14da4cc5af`);
- the rewritten frontend (Findings, Trace, Guard lab, Case, Settings, design tokens);
- server hardening and these docs.

The detection logic, the replay, the lab and the frontend the jury sees were written today.

**Commits today** (`git log --format="%h %ad %s" --date=format:"%H:%M UTC"`, as of 13:53 UTC; re-run at freeze if more land):
```
a8ed47b 12:02 UTC  Baseline: VARELQ as delivered by Codex   (code written before the event)
c3aeeb2 13:23 UTC  Rebuild VARELQ: audit-ledger UI, reliability v2, guard lab, hardened NIM client, GPU OCR path
29d8211 13:47 UTC  Pace hosted NVIDIA calls to stay under trial-key rate limits
fe2bb05 13:53 UTC  Fix self-hosted OCR route: the nemotron-ocr-v2 NIM serves POST /v1/ocr
```

**Build-time AI contribution** *(form box)*:
> The pre-event baseline was written by OpenAI Codex. Today's work was written by Claude Code agents (Anthropic) working in parallel streams under our direction: we set the scope, the contract and the design, reviewed and tested the output, and made every product decision. Rules, evaluation and replay are code we can explain line by line; no finding is produced by the build tools.

### Brev usage

*(form box)*:
> One Brev instance, varelq-ocr (GCP g2-standard-8, NVIDIA L4 24 GB), running the nemotron-ocr-v2 NIM and the public VARELQ demo behind an access-code gate and a Cloudflare quick tunnel. LLM calls go to hosted NVIDIA Build. App OCR through the L4 NIM verified at 14:59 Tunis (458 ms, no fallback). If self-hosted OCR fails, it retries once on the hosted endpoint, marked "fallback". VM booted about 12:48 Tunis; about $1.08/h. No speed claim.

- Status: the NIM and the demo app run on the L4; the app calls the NIM at `/v1/ocr`. The hosted smoke test found the app calling `/v1/infer`; fixed in `fe2bb05`. App-side L4 inference verified at 13:59 UTC (14:59 Tunis): a three-way-short-delivery analysis through the public app (access-code gate) succeeded, run `be1bba179ec54a7f96494e14da4cc5af`, OCR `endpoint_kind: self-hosted`, provider "NIM on Brev L4", 458 ms, `fallback_used: false`, 3 differences found (price vs order, received vs ordered, invoiced vs received), 16.8 s wall time. No `deploy/gpu-capture.json` in the repo yet.
- Measured OCR latency in the demo DB, hosted endpoint: 980 ms on the three-way invoice (run `f3d8d8bb317c496f9c52550c45d6eb10`), 536 ms on SROIE receipt 000 (run `1230f004874c419d8f963ce5057d4a87`). L4 NIM: 458 ms on the three-way invoice (run `be1bba179ec54a7f96494e14da4cc5af`). These are single measurements, not a comparison; no speed claim.
- Teardown is the user's job; see the top of this file.

### Fallbacks

| Failure | What happens | Visible as |
|---|---|---|
| NVIDIA Build 429/500/503/timeout | `nim.py` retries with backoff (2 retries by default) and counts retries by status | `usage.retries_by_status` in the report |
| Model output is not valid JSON | One repair retry; then the group uses a template explanation | "Template" tag instead of "Model" |
| No API key | Rules, evaluation, replay and checks run; explanations use templates | "Template" tags, report limitation line |
| Self-hosted OCR down or slow (20 s) | One retry on hosted OCR | `fallback_used: true`, chip "OCR · hosted (fallback)" |
| A backend module fails to import | Its routes return 503; the rest of the app stays up | `/api/health` `modules` map |
| Lab agent model call fails | Retried with backoff; a run that still fails is recorded as an error and counted, never replaced | `errors` in the batch summary, error span in the trace |

---

## 4. Reliability and testing

Every number below comes from the demo DB, an earlier batch today (labelled), or the test suite, with its run or batch ID.

| Claim | Value | Evidence |
|---|---|---|
| Automated tests | 115 passed, 0 failed | `python -m unittest discover -s . -p "test_*.py"` at commit `fe2bb05` |
| Live analysis, demo DB (explain on) | 1 run (only one was seeded), success; 8,563 ms total (explain 7,803 ms); explanations tagged `model`; retries `{429: 2}` | run `4c29b27e491b4451ac6128bfafef8228` |
| Live analyses, earlier batch today (separate scratch DB, seeded 13:35 UTC) | 5/5 succeeded; median latency 21,803 ms | runs `8bc602cff74e493bb311cb11a58e46b8`, `1f7f377e6e6a4205a80fafee662d6088`, `16420c552bb04feaa06b3399494156ab`, `854e3823407649719ca65647cf7ff8aa`, `1381e902ccdc4fcf8037a0bd2ec22cfe` |
| Rule groups identical across those 5 runs | yes | same run IDs |
| NVIDIA retries absorbed | 13 × HTTP 429 and 1 × HTTP 503 across those 5 runs (`retries_by_status`) | same run IDs |
| R1 runs affected / occurrences | 12 / 22 | run `4c29b27e491b4451ac6128bfafef8228` |
| Held-out evaluation | flagged 14/29; hits divergent write in 9/24; 3 flagged runs match the reference | run `4c29b27e491b4451ac6128bfafef8228` |
| Replay (deterministic) | blocks 22/58 writes; intercepts 9/24 divergent runs; wrongly blocks 9 reference-correct writes (of 33) | run `4c29b27e491b4451ac6128bfafef8228` |
| R1 precision (hand-labelled) | 5/10 (first 10 of 22 occurrences; rules are deterministic) | `R1-LABELS.md`; report `4c29b27e…` lists the same first 10 items in the same order (checked) |
| Lab S4, baseline vs guarded (headline) | unsafe 5/5 vs 0/5; guarded: 4 blocked calls, 4 escalations, 0 errors | batches `b-probe-s4-b-fb59` / `b-http-s4-guard` |
| Lab S1, baseline vs guarded | unsafe 0/5 vs 0/5; guarded had 1 error (run time budget exhausted) | batches `b-http-s1-base` / `b-http-s1-guard` |
| Lab S3, baseline vs guarded | not in demo seed | none |
| Lab S0 control | not in demo seed | none |
| Lab model | all four batches are live runs of `nvidia/nemotron-3-super-120b-a12b` on NVIDIA's hosted API, recorded today | batch provenance |
| Rate limits during seeding | a 40-run lab seeding burst hit sustained HTTP 429 on the trial key; all 40 runs were recorded as errors, not hidden; pacing added (`LAB_RUN_BUDGET_S=150`, lab concurrency 2) | 8 batches `seed-s0-b-…` to `seed-s4-g-…` in the earlier scratch DB; commit `29d8211` |
| OCR fallback | unit-tested (`test_ocr.py`); not exercised in the demo DB, where every OCR page is hosted with `fallback_used: false` | runs `f3d8d8bb…`, `1230f004…` |
| Self-hosted OCR route | the hosted smoke test found the app calling `/v1/infer` instead of `/v1/ocr`; fixed | commit `fe2bb05` |
| Self-hosted OCR through the public app | three-way sample: `endpoint_kind: self-hosted`, "NIM on Brev L4", 458 ms, `fallback_used: false`, same 3 differences | run `be1bba179ec54a7f96494e14da4cc5af` (13:59 UTC) |
| Three-way sample | `qty_invoiced_vs_received` found on SKU-1 (with `price_invoice_vs_order` and `qty_received_vs_ordered`); 17 line boxes | run `f3d8d8bb317c496f9c52550c45d6eb10` |

**Reliability summary** *(form box)*:
> 115 automated tests pass. Five live analyses today: 5/5 succeeded, median 21.8 s, 13 HTTP 429s and one 503 absorbed by retries. A 40-run lab burst hit sustained 429s; those runs are recorded as errors, not hidden, and calls are now paced. Replay reports its own false blocks (9 reference-correct writes). R1 hand-labelled precision 5/10. Lab S4: unsafe 5/5 baseline vs 0/5 guarded. Every number has a run ID.

**Known limitations:**
- Rules R1–R3 encode the τ-retail policy; another domain needs its own rule pack.
- R1 matches the literal word "yes" in the latest user turn only. Hand-labelled precision is 5/10: its false positives are confirmations given earlier in the conversation or worded without "yes" (see R1-LABELS.md).
- Replay does not simulate how the agent would react to a block.
- The lab is synthetic and small (5 runs per arm); runs are paired by index, not replays of each other. The demo seed has S4 and S1 only; the S0 clean control and S3 were not seeded.
- Model explanations are hypotheses; the flagged step is the evidence.

---

## 5. Responsible AI and data

*(form box)*:
> No real customer data: τ-bench users are simulated and the lab and invoices are synthetic. Benchmark answers are held out from the model. The guard blocks and escalates to a human; it never approves a payment. Model text is tagged. Keys stay server-side. Limitation: untrusted document text could steer an unguarded agent (modelled by lab scenario S3); that is why the guard sits at dispatch.

- Licences are cited in section 3.
- Uploaded document binaries are not stored; results stay in a local, git-ignored SQLite file.
- The server binds to 127.0.0.1, checks Host and Origin, and sends no CORS headers.
- Seeded demo runs are labelled "Recorded 27 Sep"; synthetic numbers carry a "Synthetic" tag in the UI.
