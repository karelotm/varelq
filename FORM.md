# Submission form: answers in form order

Video timestamps refer to the 80 s demo video.

---

**Country:** [your country]

**Hackerspace / ONLINE:** [your confirmed space or ONLINE]

**Team name:** Solo Leveling

**Team leader full name:** Karim EL Otmani

**Team leader email:** info@karelotm.dev

**Project title:** VARELQ: finding the hidden failures of AI agents in operations

**Team members:** Karim EL Otmani

**Team group picture:** (optional; your photo, or leave empty)

---

**Project summary (146 words):**

Companies are handing back-office work, such as approving invoices, refunds and order changes, to AI agents. When those agents fail, they fail quietly, buried in hundreds of runs. VARELQ finds those hidden failures. It checks every step and tool call of recorded agent runs, groups the mistakes that repeat, ranks them by severity times runs affected, and opens the exact failing step with the broken policy highlighted. It then proves the fix: our payment agent on NVIDIA Nemotron approved an invoice without a delivery receipt in 5 of 5 runs; with VARELQ's guard, 0 of 5, and 4 were handed to a human. The same evidence engine reconciles invoices, purchase orders and receipts, read by NVIDIA OCR on our own Brev L4 GPU. Key features: guided tour, search, data chat with cited sources, agent-log import, live GPU and usage metrics. Next: connect SupplyzPro's own agent logs.

---

**Problem solved:**

Operations teams now let AI agents approve payments, refunds and order changes. When an agent breaks policy (pays without proof of delivery, changes an order without the customer's clear yes), the failure is buried in hundreds of logs. Nobody can see which step broke, which failures keep recurring, or which fix to ship first.

---

**Solution and key features:**

(1) Works now:
- **Agent reliability:** 29 failed AgentRx runs are checked step by step. Recurring failures are grouped by rule and ranked as severity × runs, e.g. "write without the customer's explicit yes", 12 runs, priority 3 × 12 = 36 (video 0:12–0:34).
- **Trace inspector:** opens the exact failing step with the policy clause highlighted (0:34–0:41).
- **Guard lab:** the same payment scenario is rerun without and with a guard. Unsafe payments go from 5/5 to 0/5, and 4 are escalated to a human (0:42–0:57).
- **Documents:** invoice, PO and receipt are read by OCR (scans too). Fields are extracted and compared by deterministic code. Example: "invoiced 200, received 180" linked to the source line, with "Verify"/"Check" labels on uncertain OCR lines (0:58–1:10).
- **Import agent logs:** analyse any agent's JSON/JSONL logs.
- **Ask VARELQ:** a chat that answers only from saved records, with cited sources.
- **Also:** guided tour, Ctrl+K search, notifications, settings with live GPU and NVIDIA usage, EN/FR interface.

(2) Mocked, simulated or unfinished:
- The guard-lab agent is real (live Nemotron calls), but it runs on a synthetic supplier/invoice store with an injected receiving-service timeout.
- Invoice sample sets are synthetic and labelled on the document.
- Organizations are local profiles; there are no real accounts or authentication (only an access-code gate).
- There are no checks yet for duplicate lines, missing receipt lines or currency mismatch.
- The guard's false-block rate on legitimate payments has not been measured.

(3) Built during the hackathon vs reused:
- **Built today:** all application code. A Codex prototype came first; the earliest file is 11:13 Tunis. It was then rebuilt and extended with Claude Code. The history is in git: https://github.com/karelotm/varelq/commits
- **Reused:** open fonts (IBM Plex, Source Serif 4), public datasets (AgentRx, SROIE, CORD) and NVIDIA models. No templates or UI kits.

---

**Technologies used:**

- **NVIDIA models (NVIDIA Build API):** Nemotron 3 Super 120B, Nemotron 3.5 Lightning 30B (fallback), nemotron-3-embed-1b.
- **NVIDIA OCR:** nemotron-ocr-v2 as a NIM on an NVIDIA Brev L4 GPU.
- **Stack:** Python 3.12 (standard-library server) with SQLite; vanilla JavaScript ES modules with no build step.
- **Tooling:** Playwright and edge-tts for the demo video; Cloudflare tunnel for the demo link.

---

**Source code URL:** https://github.com/karelotm/varelq

**Presentation URL:** [Drive PDF link, viewable by anyone with the link]

**90-second demo video URL:** [Loom / unlisted YouTube / Drive link; test it in a private window]

---

**Project next step:**

Run VARELQ on SupplyzPro's own agent logs. Write a rule pack for their procurement and support policies, replay candidate guards over their recorded runs, and ship the guard with the best trade-off between intercepted failures and false blocks, measured before it goes live. In parallel, add the missing document checks and calibrate OCR confidence on about 100 real receipts.

---

**Partner awards (checkboxes):**
- Thunders: Engineering Excellence
- Guepard: AI Automation
- SupplyzPro: Smart Operations
- Artefact: Data & AI

**Primary prize (dropdown):** SupplyzPro: Smart Operations Award

---

**Award application: fit and eligibility:**

**SupplyzPro, Smart Operations:**
- **Fit:** VARELQ solves "Find the Hidden Failures". Deterministic rules detect failures at the level of each conversation step and tool call, group them by rule (with embedding similarity), and prioritise them as severity × runs affected, with evidence one click away.
- **Evidence:** on 29 failed AgentRx runs, the top group "write without explicit yes" covers 12 runs (priority 36). Flagged steps hit the actual wrong action in 9 of 24 divergent runs. The guard lab then proves a fix (5/5 → 0/5 unsafe). See video 0:12–0:57, ACCURACY.md and the Agent reliability page in the live demo.
- **Eligibility:** [country] team; SupplyzPro's other eligibility details are TBC.

**Thunders, Engineering Excellence:**
- **Fit and evidence:** a reliable, tested prototype. It has 152 automated tests and an accuracy report measured against ground truth on 41 documents with 95% intervals (ACCURACY.md). It also has model and OCR fallbacks, rate-limit pacing, and errors recorded instead of hidden.
- **Eligibility:** [country] team; award open to one team.

**Guepard, AI Automation:**
- **Fit and evidence:** an AI workflow that removes manual audit work. Invoice/PO/receipt reconciliation is automated with OCR and extraction, and the guard automatically stops an AI agent from paying unsafely and escalates to a human (video 0:42–0:57, Guard lab page).
- **Eligibility:** [country] team.

**Artefact, Data & AI:**
- **Fit and evidence:** turns raw agent logs into prioritised, measured insight. Findings are scored against held-out benchmark references (9/24 divergent runs hit, 3 false-positive runs reported), with before/after guard rates. The data-quality measurements are published in ACCURACY.md.
- **Eligibility:** open to all participating countries.

---

**AI/tool disclosure:**

AI inside the product:
- **Nemotron 3 Super 120B (NVIDIA Build API):** extracts invoice fields, explains finding groups, runs the guard-lab payment agent, answers the data chat, and groups imported agent logs.
  - Example input: invoice INV-0142 image + PO-7781 + GRN-7781.
  - AI action: nemotron-ocr-v2 reads the lines; Nemotron extracts quantities and prices.
  - Output: deterministic code (not the AI) flags "invoiced 200, received 180, +20" and links it to the source line.
- **Nemotron 3.5 Lightning 30B:** automatic fallback when the 120B is rate-limited. The model that answered is recorded on every run.
- **nemotron-3-embed-1b:** similarity inside failure groups.
- **nemotron-ocr-v2:** a NIM on our Brev L4, with NVIDIA's hosted OCR as fallback.
- **Simulated parts:** the guard-lab scenarios use a synthetic supplier store with an injected timeout (the model calls are real); the sample invoices are synthetic.

AI used to build the project:
- **OpenAI Codex:** the first prototype this morning.
- **Claude Code (Anthropic):** redesign, new features, tests, accuracy evaluation, deck and demo-video pipeline.
- **What I checked:** every result against live runs and tests. A wrong OCR endpoint and several honesty issues were caught and fixed. All numbers come from recorded run IDs.

Datasets, APIs and assets:
- **Datasets:** Microsoft AgentRx / τ-bench retail (MIT), ICDAR 2019 SROIE (MIT repository), CORD v2 (CC-BY-4.0), and our own synthetic invoices.
- **APIs:** NVIDIA Build API.
- **Generated assets:** the demo-video voice (edge-tts, Microsoft neural voice) and an automated Playwright screen recording.
- **Access constraint:** the trial key is limited to 40 requests/min, so calls are paced.
- **Fallbacks:** the smaller model, hosted OCR, and human review for uncertain values.

NVIDIA Brev: one L4 (GCP g2-standard-8, about $1.07/h from event credit) runs the OCR NIM, the app and an access-code gate for the demo link. Live GPU metrics are shown in the app's Settings.

---

**Project cover / screenshot URL:** https://raw.githubusercontent.com/karelotm/varelq/main/docs/screenshot-guard-lab.png

**Live demo URL:** https://grade-gods-font-checks.trycloudflare.com

The demo access code goes in the README/presentation or the testing field below, not here. Suggested wording if needed: "Reviewer demo code: varelq-e665f873 (shared gate, not a personal password)".

---

**Testing, results and known limitations:**
- **40 new documents, each run twice:**
  - Totals on 20 real SROIE receipts: 18/20 correct.
  - Planted problems on 7 synthetic sets: 3/7 found. Duplicate line, missing receipt line and currency mismatch have no check yet, and one price error was missed on a blurry scan.
  - Clean controls: no false alarm in 5 of 6 runs.
  - Source: ACCURACY.md §5.
- **Guard lab, S4 (receiving record missing):** unsafe payments 5/5 without the guard vs 0/5 with it, 4 escalated. Batches b-probe-s4-b-fb59 and b-http-s4-guard; video 0:42. Only one scenario with n = 5 each, and false blocks were not measured.
- **Speed, cost and failures:**
  - OCR on the L4: about 260 ms; the hosted service took 550–980 ms.
  - A document analysis takes 12–40 s.
  - HTTP 429 rate limits made 40 lab runs fail. They were recorded as errors, not hidden, and calls are now paced with a model fallback.
  - The demo runs on a Brev L4 at about $1.07/h.

---

**Responsible AI and data:**

- **Data:** public benchmarks used under their licences (AgentRx MIT, SROIE MIT, CORD CC-BY-4.0) or synthetic data labelled on every document. No personal or customer data is used.
- **Human oversight:** VARELQ never pays or sends anything. Findings are hypotheses a person reviews, and uncertain OCR lines are flagged "Verify".
- **Grounding:** model citations are checked against real records, invented IDs are removed, and all arithmetic is done in code.
- **Security and privacy:** API keys stay server-side and uploaded document files are not stored.
- **Unresolved risks:** the OCR confidence is not calibrated, and false blocks of the guard have not been measured.

---

**Final confirmation:** tick it only after every link opens in a private window.

**Public showcase:** your choice. Yes is fine: nothing private is in these fields, and the access code is not in them.
