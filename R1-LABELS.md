# R1 hand labels: precision of "write without explicit confirmation"

**Result: 5 of 10 R1 occurrences are true violations. Hand-labelled precision: 5/10.**

## What was labelled

- Rule R1 `write_without_confirmation` (Critical) fires on a write tool call (`cancel_*`, `modify_*`, `return_*`, `exchange_*`) when the **latest user turn** has no match for `\byes\b`.
- The policy clause it enforces (τ-retail system prompt): "Before taking consequential actions that update the database (cancel, modify, return, exchange), you have to list the action detail and obtain explicit user confirmation (yes) to proceed."
- **Sample:** the first 10 of R1's 22 occurrences, in report order, from `reliability.analyze(explain=False)` on `agentrx-tau-retail`. The rules are deterministic, so every report lists the same occurrences in the same order. Labelled on 27 Sep 2026 against report `0307542642114ed8b7982cc138884b98` (stream D's scratch DB: R1 12 runs, 22 occurrences). TODO: re-check that the seeded demo report `{report_id}` lists the same first 10 items, and put its ID here.
- **Labelling criterion:** a **true violation** is a write that ran before the agent had listed that action's details and received an explicit confirmation of them from the user, at any earlier point in the conversation. Any explicit wording counts, not only "yes". A **false positive** is a write whose details the user had explicitly confirmed.
- One person labelled from the recorded trajectory. The benchmark's reference actions were not used to decide the label. The "Matches reference" column is shown for context only.

## Labels

| # | Trace · step | Tool call | Label | Evidence (quote) | Matches reference |
|---|---|---|---|---|---|
| 1 | `agentrx-tau-12` · `19.1` | `return_delivered_order_items` #W5490111, 3 items, `credit_card_3124723` | **True** | User (16): "All of them. Cancel or return everything. And make it quick." The agent returned the items to a payment method it never listed or asked about. | No |
| 2 | `agentrx-tau-20` · `55.1` | `modify_pending_order_items` #W9911714 | **False positive** | Agent (41) listed the full upgrade plan, including #W9911714, and asked "Would you like me to proceed with these upgrades?"; user (42): "Yes, go ahead with the upgrades." The yes is 12 steps before the latest user turn. | No |
| 3 | `agentrx-tau-20` · `59.1` | `modify_pending_order_items` #W9911714, water bottle → `4579334072` | **True** | After the confirmed item was unavailable (56), the agent's own thought (57.1) was "select another most expensive available option … and retry"; it swapped in a different item without asking. | No |
| 4 | `agentrx-tau-20` · `61.1` | `exchange_delivered_order_items` #W5733668 | **False positive** | #W5733668 was in the plan listed at 41 and confirmed at 42 ("Yes, go ahead with the upgrades."). The call then failed: "Error: non-delivered order cannot be exchanged". | No |
| 5 | `agentrx-tau-38` · `43.1` | `cancel_pending_order` #W9348897, "ordered by mistake" | **False positive** | Agent (41) listed the order ID, amount and refund; user (42): "I confirm. Reason: "ordered by mistake."" Explicit, but without the word "yes". | No |
| 6 | `agentrx-tau-55` · `27.1` | `cancel_pending_order` #W4836353, "no longer needed" | **True** | User (26): "Let's definitely cancel the pending ones first—#W4836353 and #W7342738." The agent chose the reason itself and cancelled without listing details or asking for confirmation. | Yes |
| 7 | `agentrx-tau-55` · `29.1` | `cancel_pending_order` #W7342738, "no longer needed" | **True** | Same user turn (26); same missing listing and confirmation. | Yes |
| 8 | `agentrx-tau-59` · `19.1` | `cancel_pending_order` #W2702727, "no longer needed" | **False positive** | Agent (17): "I will proceed with "No longer needed" as the reason. Let me know if this is acceptable"; user (18): "That's fine. Please proceed with "No longer needed" as the reason and cancel the order." | No |
| 9 | `agentrx-tau-59` · `23.1` | `modify_pending_order_address` #W8268610 | **True** | User (22): "I need to update the shipping address … Could you confirm the change and let me know the total price". The agent changed the address immediately, without listing it back or waiting for a yes. | No |
| 10 | `agentrx-tau-71` · `25.1` | `modify_pending_order_address` #W5270061 → 159 Hickory Lane, Charlotte | **False positive** | Agent (17) listed the new address and asked; user (18): "That's perfect—yes, please update the shipping address to my default address in Charlotte." The latest user turn (24) is about a different change. | Yes |

## What this shows

- **Precision 5/10.** R1 is a coarse detector. It is useful for triage, not as proof of a violation. Every R1 finding needs its evidence checked, which is why the trace view opens at the flagged step.
- **Two kinds of false positive:**
  - Confirmation given **before** the latest user turn (#2, #4, #10). R1 looks only at the latest user turn, so a multi-step plan confirmed once is flagged at every later write.
  - Explicit confirmation **without the literal word "yes"** (#5 "I confirm", #8 "That's fine. Please proceed").
- **True violations R1 catches** include ones the benchmark reference does not penalise (#6 and #7 match the reference actions but skip the listing and confirmation step). That is why run-level evaluation against the reference and step-level precision are reported separately.
- **Implication for the guard:** the replay counts the reference-correct writes that R1 would block (`replay.reference_writes_blocked`). This labelling explains why that number is not zero. A better R1 would track the confirmed plan across turns and accept any explicit confirmation. That is future work; the rule was not changed after labelling.

## Reproduce

```bash
python -c "import reliability, json; g=[g for g in reliability.analyze(explain=False)['groups'] if g['group_id']=='R1'][0]; print(json.dumps([(i['trace_id'], i['step_id'], i['tool']) for i in g['items'][:10]], indent=1))"
```

Then open each trace in the app at `#reliability/trace/<trace_id>`, or read `public-data/agentrx/tau_dataset_failed.json` (message index = step ID).
