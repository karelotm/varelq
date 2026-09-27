# VARELQ: submission kit

GOMYCODE × NVIDIA "Come Build with AI", 27 September 2026. Deadline 17:30 Tunis; our target is 17:00 Tunis.

> **Teardown after the event (the user does this; agents may not):**
> 1. After 19:45 Tunis: `docker exec varelq-brev-client ssh varelq-ocr 'docker rm -f varelq-ocr'`
> 2. `docker exec varelq-brev-client brev stop varelq-ocr`, or delete the instance in the Brev console.
> 3. Revoke the temporary NVIDIA key at build.nvidia.com.

**How to use this file.** Each block marked *form box* is pasted as-is into the form and is under 500 characters. `TODO {…}` marks a value that comes from the final seeded run (`scripts/seed_demo.py`, see DEMO.md). No number is filled in until it is in the seeded DB with a run ID. Delete this paragraph before sharing the file.

---

## 1. Project card

**Name:** VARELQ

**One-line story** *(form box)*:
> VARELQ finds the hidden failures in AI operations agents: it pins each failure to the exact step and tool call, groups the recurring patterns, ranks them with evidence, and proves the fix, first by replaying a guard over the recorded runs and then with a live guarded rerun.

**Team:** TODO {team name and members, exactly as in the Final Team Confirmation; lead email must match}

**Tools** *(form box)*:
> NVIDIA Nemotron 3 Super 120B (NVIDIA Build API) for finding explanations and the guard-lab agent; NVIDIA nemotron-ocr-v2 TODO {"as a NIM on a Brev L4, with hosted fallback" only if app inference via the tunnel is verified; otherwise "hosted (a Brev L4 NIM was deployed but not used by the app)"}; Python 3.12 standard library + SQLite; vanilla JS ES modules; IBM Plex, Lucide. Built with Claude Code (multi-agent) today on a Codex-built baseline from before the event.

**Next step** *(form box)*:
> Run VARELQ on SupplyzPro's own agent logs: write a rule pack for their procurement and support policies, replay candidate guards over their recorded runs, and ship the guard with the best trade-off between intercepted failures and false blocks, measured before it goes live.

**Links:**
- Video (90 s): TODO {video URL, following the briefing's hosting rule}
- Repo: TODO {https://github.com/karelotm/varelq, only after the user approves publishing}
- Run instructions: README.md, "Run it"

### Award selection

**Primary (dropdown):** SupplyzPro Smart Operations Award. TODO: confirm at the briefing that it is not Tunisia-only for our country; if it is, the primary becomes Artefact Data & AI.

**Secondary (checkboxes), one line each** *(form boxes)*:
- **SupplyzPro** (if not primary): "Step-level detection in conversations and tool calls, groups tied to rule IDs, an inline priority formula, evidence one click away, and a replay proof that reports its own false blocks."
- **Thunders Engineering Excellence:** "Tested and measured: TODO {tests} automated tests, TODO {ok}/5 live analysis runs succeeded with latency and 503-retry counts recorded, OCR fallback exercised, and every number tied to a run ID."
- **Artefact Data & AI:** "Recorded agent runs become prioritised findings, scored against held-out benchmark reference actions (hits and false positives), with replay and lab rates that include a clean control."
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

**Proof, on 29 failed τ-bench retail runs** *(form box; fill from the seeded report `TODO {reliability_run_id}`)*:
> R1 "write without explicit confirmation" affects TODO {R1 runs} runs. Flagged TODO {n}/29 runs; a flagged step hits the divergent write in TODO {m}/24 divergent runs; TODO {fp} flagged runs match the reference. Replay: blocks TODO {b}/TODO {w} writes, intercepts TODO {k}/24 divergent runs, wrongly blocks TODO {j} reference-correct writes. R1 hand-labelled precision 5/10.

Pre-check values (from the planning pre-check, to be confirmed by the seeded report before use): R1 fires in 12 runs, on 22 of 58 writes; 24 runs are divergent; R1 alone would block 9 reference-correct writes.

---

## 3. AI and tool disclosure

### Models and APIs

| Model | Endpoint | Purpose |
|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b` | NVIDIA Build, `https://integrate.api.nvidia.com/v1/chat/completions` (hosted) | One explanation and fix per finding group (JSON mode, thinking off). Tagged "Model"; on failure, a template tagged "Template" is used. Also extracts invoice fields |
| `nvidia/nemotron-3-super-120b-a12b` | Same | The guard-lab AP agent (JSON-action protocol, temperature 0.7, seed = run index, at most 8 turns) |
| `nvidia/nemotron-ocr-v2` | Self-hosted NIM `nvcr.io/nim/nvidia/nemotron-ocr-v2:2.0` on a Brev L4, over an SSH tunnel (TODO: app inference via the tunnel not verified yet); fallback: hosted `https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2` | OCR of invoice images, with line boxes. Each page records `endpoint_kind`, `latency_ms` and `fallback_used` |
| `nvidia/nemotron-3-embed-1b` | NVIDIA Build (hosted) | P1, only if shipped: a cohesion score per group ("embedding cosine"). Groups are formed by rules, not by embeddings. TODO: delete this row if cohesion did not ship |

**What decides and what does not:** detection (rules R1–R3), priority, evaluation, replay, the lab's safety oracle and the invoice checks are deterministic Python. The model explains findings and acts as the lab agent. It never decides what is flagged.

**AI disclosure** *(form box)*:
> Models: Nemotron 3 Super 120B (NVIDIA Build) explains finding groups and runs the lab agent; nemotron-ocr-v2 TODO {"NIM on a Brev L4 (hosted fallback)" only if tunnel inference is verified; otherwise "hosted"} reads invoices. Detection, ranking, evaluation and replay are deterministic code; model text is tagged. Data: τ-bench via AgentRx (MIT), one SROIE receipt, synthetic lab and invoice data. Code: Codex baseline before the event; Claude Code multi-agent build today.

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
- The app is a local single-user prototype with no authentication. It binds to 127.0.0.1.

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
- the Brev OCR NIM deployment (tunnel and app-side inference: TODO, not verified yet);
- the rewritten frontend (Findings, Trace, Guard lab, Case, Settings, design tokens);
- server hardening and these docs.

The detection logic, the replay, the lab and the frontend the jury sees were written today.

**Commits today** (TODO: paste the output of `git log --since="2026-09-27 12:02 +0000" --format="%h %ad %s" --date=format:"%H:%M UTC"` at freeze):
```
a8ed47b 12:02 UTC  Baseline: VARELQ as delivered by Codex   (code written before the event)
TODO {lead commits at 13:45 and 14:30 UTC}
```

**Build-time AI contribution** *(form box)*:
> The pre-event baseline was written by OpenAI Codex. Today's work was written by Claude Code agents (Anthropic) working in parallel streams under our direction: we set the scope, the contract and the design, reviewed and tested the output, and made every product decision. Rules, evaluation and replay are code we can explain line by line; no finding is produced by the build tools.

### Brev usage

*(form box)*:
> One Brev instance, varelq-ocr (GCP g2-standard-8, NVIDIA L4 24 GB), running one container: the nemotron-ocr-v2 NIM. NIM deployed and health-ready on a Brev L4; app inference via SSH tunnel on 127.0.0.1: TODO {verified at HH:MM | not verified, hosted OCR used}. Nothing is public. If the self-hosted OCR fails or times out, OCR retries once on NVIDIA's hosted endpoint and the page is marked "fallback". VM booted about 12:48 Tunis; about $1.08/h, about $8 to 20:00. No speed claim.

- Status: TODO {"NIM ready at HH:MM Tunis, nvidia-smi captured at HH:MM (deploy/gpu-capture.json)"} **or**, if the 14:30 go/no-go failed: "Brev: attempted; the OCR NIM did not reach readiness; hosted OCR used."
- Measured OCR latency on the demo sample: TODO {ms} ms (run TODO {document_run_id}). This is a measurement, not a comparison. The path is Windows → Docker → SSH → cloud L4, so it may be slower than hosted.
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

Every number below comes from the seeded demo DB or the test suite. Fill in each row with its run ID; delete any row that cannot be backed by one.

| Claim | Value | Evidence |
|---|---|---|
| Automated tests | TODO {tests} passed, 0 failed | `python -m unittest discover -s . -p "test_*.py" -v` at freeze |
| Live analysis runs (explain on) | TODO {ok}/5 succeeded; median latency TODO {analysis ms} ms | run IDs TODO {5 ids} |
| Rule groups identical across the 5 runs | TODO {yes/no} | same run IDs |
| NVIDIA 503 retries | TODO {r503} across 5 runs (`retries_by_status`) | same run IDs |
| R1 runs affected / occurrences | TODO {R1 runs} / TODO {occ} | run TODO {id} |
| Held-out evaluation | flagged TODO {n}/29; hits divergent write in TODO {m}/24; TODO {fp} flagged runs match the reference | run TODO {id} |
| Replay (deterministic) | blocks TODO {b}/TODO {w} writes; intercepts TODO {k}/24 divergent runs; wrongly blocks TODO {j} reference-correct writes | run TODO {id} |
| R1 precision (hand-labelled) | 5/10 (first 10 of 22 occurrences; rules are deterministic) | `R1-LABELS.md`; TODO confirm the seeded report {report_id} lists the same items |
| Lab S1, baseline vs guarded | unsafe TODO {x}/5 vs TODO {y}/5 | batches TODO {ids} |
| Lab S4, baseline vs guarded | unsafe TODO {x4}/5 vs TODO {y4}/5 | batches TODO {ids} |
| Lab S3, baseline vs guarded | unsafe TODO {x3}/5 vs TODO {y3}/5 | batches TODO {ids} |
| Lab S0 control | legitimate approvals TODO {a}/5 vs TODO {a'}/5; false blocks TODO {f} | batches TODO {ids} |
| OCR fallback exercised | `fallback_used: true` with the tunnel down | run TODO {id} |
| Three-way sample | `qty_invoiced_vs_received` found; line boxes present | run TODO {id} |

**Reliability summary** *(form box)*:
> TODO {tests} automated tests pass. Five live analyses: TODO {ok}/5 succeeded, median TODO {analysis ms} ms, TODO {r503} NVIDIA 503s absorbed by retries. Replay reports its own false blocks (TODO {j} reference-correct writes). R1 hand-labelled precision 5/10. The lab includes a clean control: TODO {f} false blocks. OCR fallback tested with the GPU tunnel down. Every number has a run ID.

**Known limitations:**
- Rules R1–R3 encode the τ-retail policy; another domain needs its own rule pack.
- R1 matches the literal word "yes" in the latest user turn only. Hand-labelled precision is 5/10: its false positives are confirmations given earlier in the conversation or worded without "yes" (see R1-LABELS.md).
- Replay does not simulate how the agent would react to a block.
- The lab is synthetic and small (5 runs per arm); runs are paired by index, not replays of each other.
- Model explanations are hypotheses; the flagged step is the evidence.

---

## 5. Responsible AI and data

*(form box)*:
> No real customer data: τ-bench users are simulated and the lab and invoices are synthetic. Benchmark answers are held out from the model. The guard blocks and escalates to a human; it never approves a payment. Model text is tagged. Keys stay server-side. Limitation: untrusted document text can steer an unguarded agent (lab scenario S3); that is why the guard sits at dispatch.

- Licences are cited in section 3.
- Uploaded document binaries are not stored; results stay in a local, git-ignored SQLite file.
- The server binds to 127.0.0.1, checks Host and Origin, and sends no CORS headers.
- Seeded demo runs are labelled "Recorded 27 Sep"; synthetic numbers carry a "Synthetic" tag in the UI.
