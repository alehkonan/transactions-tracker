---
target: "Accounts: spheres and allocations"
total_score: 21
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
target_identity: "file:/Users/aleh/Projects/transactions-tracker/src/routes/_client.accounts.tsx"
target_fingerprint: "sha256:5f77e01806a9e106fa4614989a6644ce455a7cb3d3557b93c3d48d135c64efde"
target_path: /Users/aleh/Projects/transactions-tracker/src/routes/_client.accounts.tsx
timestamp: 2026-10-25T17-18-47Z
slug: src-routes-client-accounts-tsx
---

Method: dual-agent (A: /root/design_review · B: /root/detector_evidence)

Accounts: UX review, Operate

The visual language is distinctive: the warm palette, monospace amounts and native fields suit the product. The main problem is structure: accounts answer “where is the money?” and spheres answer “what is it for?”, but the page interleaves these views.

| Heuristic                          |    /4 | Observation                                                                                     |
| ---------------------------------- | ----: | ----------------------------------------------------------------------------------------------- |
| System status                      |     3 | Synchronization is visible; warnings are not specific enough                                    |
| Match with the user's mental model |     1 | Operating, Funds, Capital and reallocation require learning                                     |
| User control                       |     3 | Cancel, archive and restore actions are available                                               |
| Consistency                        |     2 | Accounts separate Operating from the other spheres                                              |
| Error prevention                   |     2 | A negative-balance warning exists, but the action looks routine                                 |
| Recognition rather than recall     |     1 | Users must remember balances while scrolling to the form                                        |
| Efficiency                         |     2 | Allocation is separated from the relevant sphere                                                |
| Minimalism                         |     2 | Empty forms and tall rows lengthen the page                                                     |
| Error recovery                     |     3 | Forms retain input; errors use alert roles                                                      |
| Help                               |     2 | Explanations exist, but the relationship between accounts and spheres is not presented together |
| Total                              | 21/40 | The UX needs restructuring                                                                      |

Priorities:

1. **P1 — Separate two views of the same money.** Below the total, provide Accounts (“where the money is”) and Purposes (“what it is for”). Group Operating, Funds and Capital in Purposes. Explain that these are the same funds; the totals from the two views must not be added together. Keep the archived-account filter within Accounts.
2. **P1 — Allocate money from the sphere's context.** Give Vacation Assign money / Move money actions. Prefill the destination and default the source to Operating. Show both sides before → after and the available amount in the selected currency. Collapse history. Currently, Edit in history populates the form above without moving focus; this was confirmed in source code, not by clicking it.
3. **P1 — Shorten the mobile path.** Operating and every account card currently appear before Funds. Make sphere rows compact: name, amounts by currency and an action. Disclose management controls on demand and place archived spheres under Archived (N). Three Funds in the demo nearly fill a desktop screen before Capital appears.
4. **P2 — Explain negative balances more clearly.** Allocating $900 from Vacation with $600 succeeded: Vacation became −$300 and Investments $900. A warning exists, but the button remains Reallocate. For a negative result, use the explicit label Allocate anyway and show the consequences next to the button. Attach each shortfall to its currency. Distinguish allocation beyond a reserve from an actual negative account total. Make successful technical reconciliation secondary.
5. **P2 — Provide one first-use path.** Replace two empty lists and an unusable form with create a purpose → assign money immediately. Explain Funds versus Capital at type selection because the type cannot be changed later.

Preserve the palette, separate amounts by currency, native fields, warnings and the nonzero-balance archive guard. New decorative charts are unnecessary.

Cognitive load: users must connect three distant blocks (total balance, accounts and spheres), remember currency balances and learn several new terms. Novices struggle with the model; experienced users repeatedly select fields; mobile users scroll extensively. Initial trust from familiar accounts gives way to uncertainty around technical warnings and empty forms. Contextual allocation provides a clear task ending.

Verified with Safari MCP: the original profile with 8 accounts, 11,193 transactions and multiple currencies; desktop/mobile empty states. Created a separate UX Accounts demo: Everyday USD $2000, Reserve USD $500; Emergency empty, Vacation −$300, Old goal archived, Investments $900, Operating $1900. Reallocations: Operating → Vacation $600 and Vacation → Investments $900; account totals remain $2500. Original transactions were unchanged. A full VoiceOver/keyboard audit and simulated synchronization failures were not performed.

CLI detector: 0 findings. Browser overlay: summary reported 14, raw log contained 15 entries. The useful signal was excessively long explanatory lines. Other signals mainly concerned Devtools, hidden details, false attribution or brand shadows. These are not 14 confirmed product defects.

Discussion direction: open Accounts or Purposes first? Start with structure and allocation, or revise the entire flow, including empty states and archives?
