# VARELQ: 90-second demo script and recording checklist

> **Teardown after the event (the user does this; agents may not):**
> 1. After 19:45 Tunis: `docker exec varelq-brev-client ssh varelq-ocr 'docker rm -f varelq-ocr'`
> 2. `docker exec varelq-brev-client brev stop varelq-ocr`, or delete the instance in the Brev console.
> 3. Revoke the temporary NVIDIA key at build.nvidia.com.

**Timing (Tunis; machine clock = Tunis − 1h).** Freeze 15:30. Seed and review 15:30–15:50. Record and edit 15:50–16:40. Form 16:40–17:00. Hard close 17:30.

**Rules:**
- The video is recorded from the pre-seeded demo DB. Every seeded run was executed live today; the UI labels them "Recorded 27 Sep".
- `TODO {…}` values come from the seed output. **No number may be spoken or shown that is not in the seeded DB.** If a value is missing, cut the phrase; do not estimate it.
- Speed is never claimed. Never say "our own GPU". Disclaimers are tags on screen, never spoken.
- Banned words in the voice-over: "actual", "real", "not simulated".

---

## 1. Seed the demo DB (15:30 Tunis, after freeze)

The key is loaded from the scratch file into the environment only. Never echo it.

```bash
SCRATCH='C:\Users\PC\AppData\Local\Temp\claude\C--dev-Valerq\3df3c8a4-3640-449e-adfc-3b84c95ca57c\scratchpad'
cd /c/dev/Valerq
# GPU tunnel up first if the 14:30 go/no-go passed: curl -sf http://127.0.0.1:8000/v1/health/ready
NVIDIA_API_KEY="$(cat "$SCRATCH/nvidia.key")" \
NVIDIA_OCR_URL=http://127.0.0.1:8000/v1/infer NVIDIA_OCR_LABEL="NIM on Brev L4" NVIDIA_OCR_FALLBACK=hosted \
VARELQ_DB="$SCRATCH/demo.sqlite3" PORT=8390 python server.py
```

In a second shell, seed through the public API only, and keep the printed JSON:

```bash
python scripts/seed_demo.py --base http://127.0.0.1:8390 > "$SCRATCH/seed-output.json"
```

The script does, in order: the three-way sample (with `sample_id`), the SROIE sample, reliability analyze ×5 with explanations, then lab S0, S1, S3 and S4, each baseline ×5 and guarded ×5 (5 parallel calls per batch). It takes several minutes. The `placeholders` object in its output uses the same keys as the table below (`R1 runs`, `n`, `m`, `fp`, `b`, `w`, `k`, `j`, `x`, `y`, `x3`, `y3`, `x4`, `y4`, `a`, `a'`, `f`, `ms`), plus every run and batch ID. A value that could not be produced is `null`; never replace a `null` with an estimate. Useful flags: `--skip-lab`, `--skip-documents`, `--analysis-runs N`, `--lab-runs N`, `--scenarios S1,S0`.

If the script fails, seed by hand in the UI in this order and note every run and batch ID:
1. Documents → load the three-way sample "INV-0142 vs PO-7781 vs GRN-7781" → Analyze.
2. Documents → load "SROIE receipt 000" → Analyze.
3. Findings → Run analysis, five times in total (all five IDs count toward the 5/5).
4. Guard lab → for each of S0, S1, S3 and S4: Run baseline ×5, then Run guarded ×5.
5. Fallback check: stop the tunnel, rerun the three-way sample, confirm `fallback_used: true`, restore the tunnel.

Copy the values into the placeholder table below, into SUBMISSION.md section 4, and the run IDs into LIVE-VERIFICATION.md.

### Placeholder values

| Placeholder | Meaning | Where it comes from | Value |
|---|---|---|---|
| `{R1 runs}` | Runs affected by R1 (pre-check: 12) | latest report, `groups[R1].runs_affected` | TODO |
| `{n}` | Runs flagged out of 29 | `evaluation.runs_flagged` | TODO |
| `{m}` | Divergent runs with a flagged divergent write, out of 24 | `evaluation.divergent_step_hits` | TODO |
| `{fp}` | Flagged runs that match the reference | `evaluation.flagged_not_divergent` | TODO |
| `{b}` / `{w}` | Writes blocked / total writes in replay | `replay.writes_blocked` / `replay.writes_total` | TODO |
| `{k}` | Divergent runs intercepted, out of 24 | `replay.divergent_runs_intercepted` | TODO |
| `{j}` | Reference-correct writes wrongly blocked | `replay.reference_writes_blocked` | TODO |
| `{p}` | R1 hand-labelled precision, out of 10 | `R1-LABELS.md` | 5 |
| `{ok}`, `{analysis ms}`, `{r503}` | Live analyses succeeded out of 5, median latency, total 503 retries (SUBMISSION.md only, not spoken) | `analysis_success`, `analysis_ms_median`, `retries_by_status_total` | TODO |
| `{x}` / `{y}` | S1 unsafe, baseline / guarded, out of 5 | lab batch summaries | TODO |
| `{x4}` / `{y4}` | S4 (receiving record unavailable, payment pressure) unsafe, baseline / guarded, out of 5. Pre-check on port 8341: 4/5 vs 0/5 (b-vi-s4-base / b-vi-s4-guard); use the seeded values | lab batch summaries | TODO |
| `{a}` / `{a'}` / `{f}` | S0 legitimate approvals baseline / guarded, false blocks | lab batch summaries | TODO |
| `{ms}` | OCR latency on the three-way invoice | `sources.invoice.ocr_pages[0].latency_ms` | TODO |
| report ID | Reliability run shown in the video | seed output | TODO |

---

## 2. The script (about 75% SupplyzPro)

| t | Screen | Voice-over | Must be visible |
|---|---|---|---|
| 0–7 s | Overview | "Ops teams hand refunds and payments to AI agents. When one breaks policy, nobody sees which step did it." | Top failure patterns panel. Status chip "NVIDIA · nemotron-3-super" |
| 7–27 s | Findings | "We ran VARELQ on 29 failed customer-service runs from τ-bench, as republished in Microsoft's AgentRx. Deterministic rules check every step and tool call; Nemotron explains each group." | Findings table: pattern, runs affected (`{R1 runs}`), severity, and the priority inline as "Critical 3 × `{R1 runs}` runs = `{3 × R1 runs}`". Tags "Rule" and "Model". Provenance chip "τ-bench (Sierra, MIT) via AgentRx (Microsoft, MIT)". Evaluation strip: "Flagged `{n}`/29 · hits the divergent write in `{m}`/24 · `{fp}` flagged runs match the reference" |
| 27–40 s | Trace | "Each finding opens at the exact tool call, next to the policy sentence it breaks." | The timeline scrolls to the flagged `cancel_pending_order` step with its reason ("Latest user turn … contains no explicit 'yes'"). The policy clause is highlighted in the policy text |
| 40–55 s | Findings → Replay panel | "Before shipping a guard, we replay it over the same recorded runs." | "Blocks `{b}` of `{w}` writes · intercepts `{k}` of 24 divergent runs · wrongly blocks `{j}` reference-correct writes". "R1 precision (hand-labelled): `{p}`/10". Tag "Deterministic" |
| 55–78 s | Guard lab (opens on the scenario with the largest measured difference, S4 in the pre-check) | "Then we test the guard on a live procurement agent. Synthetic data: the receiving record times out and the vendor is pressing for payment. Baseline versus guarded, 5 runs each, plus a clean control where payment is legitimate." | Baseline S4 unsafe `{x4}`/5 vs guarded `{y4}`/5 (the Overview tile shows the same pair); "blocked at dispatch" on the guard span; S0 control: legitimate approvals `{a}`/5 vs `{a'}`/5, false blocks `{f}`; turns and latency medians. "Synthetic" tag |
| 78–86 s | Case (only if OCR boxes work; otherwise extend the lab beat) | "The same evidence ledger reconciles invoices; OCR runs on a Brev L4 we deployed." | Row "Invoiced 200 · Received 180 · Δ +20" with its box lit on the invoice image. Chip "OCR · NIM on Brev L4 · `{ms}` ms measured". No comparison |
| 86–90 s | Findings | "Find it, group it, prove the fix. Next: SupplyzPro's own agent logs." | Logo and URL |

**Contingencies (decide before recording, do not improvise on camera):**
- **Lab baseline is 0/5 unsafe in S4 (seeded):** say "the baseline held in these 5 runs", show S1 or S3 only if one of them failed there, and lean on the replay and on the S0 control ("no false blocks"). Never script a failure.
- **Model explanations fell back to templates:** the tag reads "Template"; change "Nemotron explains each group" to "each group comes with an explanation and a fix".
- **GPU go/no-go failed or `fallback_used` is true on the recorded case:** cut the 78–86 s beat, or say "OCR by NVIDIA nemotron-ocr-v2" without "Brev L4", and extend the lab beat.
- **R1 precision not labelled:** drop the precision line from the replay beat.

---

## 3. Recording checklist

**Before recording:**
- [ ] Server on port 8390 against `demo.sqlite3`; `/api/health` shows `nim_configured: true` and all `modules` true.
- [ ] Every placeholder above filled in from the seed output; the voice-over text updated to match.
- [ ] Chrome, window 1440×900, zoom 100%, bookmarks bar hidden, no other tabs, no extensions visible.
- [ ] Settings → Appearance: theme **Light**, density **Comfortable**, motion **Full**.
- [ ] Notifications off (Windows Focus assist); taskbar clock hidden or ignored.
- [ ] The key is not visible in any terminal, tab or window on screen. Close terminals before recording.
- [ ] Walk the demo path once: Overview → Findings (select R1) → open trace → back → Replay → Guard lab (S4 view, then S0) → Case → Findings.
- [ ] No console errors on the demo path (DevTools closed while recording).
- [ ] Anti-vibecode pass on every screen shown: no raw enums, no hex drift, every synthetic number tagged, pluralisation correct, no text below 12px.

**While recording:**
- [ ] One take per beat is fine; edit together. Keep each beat within its time.
- [ ] Cursor moves slowly; pause 1 s on every number that is spoken.
- [ ] Guard-lab numbers come from the seeded batches. Do not start a new batch on camera unless the progress bar itself is the shot.

**After recording:**
- [ ] Total length 90 s or less. It covers problem, product, proof and next step.
- [ ] Every number heard or shown matches SUBMISSION.md section 4 and the seeded DB.
- [ ] Upload per the briefing's hosting rule: TODO {rule}. Check that the link opens in a private window.
- [ ] Paste the video link into SUBMISSION.md section 1.
