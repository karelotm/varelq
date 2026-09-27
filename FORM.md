# Submission form: ready-to-paste answers

Fill the two `[…]` placeholders (country and space) before pasting.

## 1. Identity and roster

- **Team name:** Solo Leveling
- **Lead email:** info@karelotm.dev
- **Country:** [Tunisia?]
- **Space:** [your confirmed GOMYCODE space, or ONLINE]
- **Team lead:** Karim El Otmani
- **Members:** Karim El Otmani (solo entrant)

## 2. Project story

**Title:** VARELQ: evidence before decisions

**Summary (148 words):**
> Companies are handing back-office work, such as approving invoices, refunds and order changes, to AI agents. When those agents fail, they fail quietly, buried in hundreds of runs. VARELQ finds those hidden failures. It checks every step and tool call of recorded agent runs, groups the mistakes that repeat, ranks them by severity times runs affected, and opens the exact failing step with the broken policy highlighted. It then proves the fix: our payment agent on NVIDIA Nemotron approved an invoice without a delivery receipt in 5 of 5 runs; with VARELQ's guard, 0 of 5, and 4 were handed to a human. The same evidence engine reconciles invoices, purchase orders and receipts, read by NVIDIA OCR on our own Brev L4 GPU. Key features: guided tour, search, data chat with cited sources, agent-log import, live GPU and usage metrics. Next: connect SupplyzPro's own agent logs.

**Problem solved:** Operations teams cannot see which step of an AI agent broke policy, which failures recur, or which fix to ship first.

**Solution and key features:**
- Step-level failure detection in agent conversations and tool calls; grouped, prioritised findings with evidence one click away
- A guard lab with before/after reruns
- Three-way document reconciliation with OCR, where every value links to its source line and uncertain lines are marked "Verify"
- Agent-log import, a chat that answers only from saved records, a guided tour, and live GPU and NVIDIA usage metrics

**Technologies:** NVIDIA Nemotron 3 Super 120B and Nemotron 3.5 Lightning 30B (NVIDIA Build API), nemotron-ocr-v2 NIM on an NVIDIA Brev L4, nemotron-3-embed-1b, Python 3.12 + SQLite, vanilla JavaScript.

**Next step:** Run VARELQ on SupplyzPro's own agent logs with a rule pack for their policies, and measure the guard's false blocks before it goes live.

## 3. Prototype

> https://grade-gods-font-checks.trycloudflare.com. Reviewer access code: varelq-e665f873 (a shared demo gate against abuse of our API credits, not an account password). A guided tour starts on first visit. Key feature: Agent reliability, then the Guard lab (5/5 unsafe → 0/5).

## 4. Links

- **Source code:** https://github.com/karelotm/varelq
- **Presentation:** [Drive PDF link]
- **Video:** [Loom / YouTube / Drive link]

## 5. Prizes

- **Primary:** SupplyzPro Smart Operations Award
- **Additional:** Thunders Engineering Excellence, Guepard AI Automation, Artefact Data & AI

## 6. Evidence of award fit (2–3 sentences each)

**SupplyzPro Smart Operations Award**
> The theme is finding hidden failures in AI-agent conversations and tool calls, grouping them and prioritising with evidence, and that is exactly our Agent reliability page. On 29 failed AgentRx runs it groups recurring failures by rule, ranks them (severity × runs, e.g. 3 × 12 = 36) and opens the exact step; the Guard lab then proves a fix (5/5 unsafe → 0/5). Team based in [country], competing in the [country] track.

**Thunders Engineering Excellence**
> The theme is a reliable, well-engineered prototype. VARELQ ships with 152 automated tests, accuracy measured against ground truth on 41 documents with confidence intervals (ACCURACY.md), model and OCR fallbacks, rate-limit pacing, and failures recorded instead of hidden. Eligible as a [country] team.

**Guepard AI Automation**
> The theme is AI automation with real productivity value. VARELQ automates invoice / order / receipt checking with OCR and extraction, and its guard automatically stops an AI agent from paying unsafely and escalates to a human instead of auto-approving. Eligible as a [country] team.

**Artefact Data & AI**
> The theme is turning data into measured, actionable insight. VARELQ turns raw agent logs into prioritised findings scored against held-out benchmark references (flagged step hits the wrong action in 9 of 24 divergent runs), with before/after guard rates and a published accuracy report. The award is open to all countries.

## 7. AI/tool disclosure

> **Models (NVIDIA Build API):** Nemotron 3 Super 120B (field extraction, finding explanations, guard-lab agent, data chat); Nemotron 3.5 Lightning 30B (automatic fallback when the 120B is rate-limited; every run records which model answered); nemotron-3-embed-1b (similarity within failure groups).
>
> **OCR:** nemotron-ocr-v2 as a self-hosted NIM on an NVIDIA Brev L4 (GCP g2-standard-8, about $1.07/h from event credits), with NVIDIA's hosted OCR as fallback. The same L4 VM hosts the demo app behind an access-code gate and rate limit. The app shows live GPU metrics.
>
> **Agents:** our own synthetic procurement agent (Nemotron, JSON actions) for the guard lab; no third-party agents.
>
> **Datasets:**
> - Microsoft AgentRx / τ-bench retail failed runs (MIT)
> - ICDAR 2019 SROIE receipts (MIT repository)
> - CORD v2 receipts (CC-BY-4.0)
> - our own synthetic invoices, labelled SYNTHETIC on each document
>
> **Stack:** Python 3.12 stdlib server + SQLite, vanilla JS. Chosen for zero build steps and deterministic code for all arithmetic (the model never does maths).
>
> **Access constraints:** trial key limited to 40 requests/min, so calls are paced and failures are recorded.
>
> **AI contribution:** code was written with AI coding assistants during the event: OpenAI Codex (first prototype, this morning), then Claude Code (multi-agent redesign, features, tests, evaluation); git history shows every step.
>
> **Generated assets:** the video's voice is generated by edge-tts (Microsoft neural voice) reading our script; the screen recording is an automated Playwright walkthrough.
>
> **Fallback:** hosted OCR, the smaller Nemotron model, and human review for anything uncertain.
