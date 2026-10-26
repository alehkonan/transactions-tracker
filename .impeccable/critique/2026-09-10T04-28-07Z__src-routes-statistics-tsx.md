---
target: /statistics
total_score: 25
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
target_identity: "file:/Users/aleh/Projects/transactions-tracker/src/routes/statistics.tsx"
target_fingerprint: "sha256:b3f53402dc8ab9ab3b2d210e12f273dff7c9f57044d01d50d7ef9ec0cdb48c14"
target_path: /Users/aleh/Projects/transactions-tracker/src/routes/statistics.tsx
timestamp: 2026-09-10T04-28-07Z
slug: src-routes-statistics-tsx
---

Method: dual-agent (A: 8121dac2-c05b-4dc9-992d-c36b6bc13a33 · B: 07ca08c0-9714-47ba-819d-2af6dd484a18)

# Critique: /statistics

Target: src/routes/statistics.tsx and src/modules/statistics. Mode: Operate.

## Overall Verdict and Design Specificity

25/40. The page is visually coherent but does not explain the money clearly enough. The main opportunity is to connect available funds, spending and financial runway clearly, rather than introduce a new visual system.

The visual language is distinctive: warm paper, brown text and restrained semantic colors suit Cracker Tracker. The composition is conventional: three equally weighted cards above a large chart. According to PRODUCT.md, the product's key answer is how long funds would last if income stopped; here, it appears third and is subordinate to Averages.

The current code, desktop at 1440×900 and mobile at 390×844 were inspected; the independent assessments collectively covered light and dark themes. Data was synthetic. This is an expert UX critique, not a full accessibility audit.

## What Works

1. A calm visual environment: flat surfaces, careful borders and meaningful colors do not compete with the figures.
2. Categories are directly readable: ranked bars, names, exact amounts and transaction counts require no separate legend.
3. There is no horizontal scrolling at the tested phone width; the summary and chart are quickly accessible, and cards have comfortable tap areas. The period is reflected in the URL, and keyboard navigation through the chart works.

## Priority Issues

### [P1] Runway appears more precise and reliable than its visible basis supports

The synthetic dataset contains transactions only for July–September. With unchanged records and a $36,275 balance, switching 3M → 6M changed spending from $83.06/day → $41.76/day and runway from 1 year 2 months → 2 years 4 months. The calculation divides spending by the full calendar period. Missing earlier records could be interpreted as genuinely lower spending. Empty by sounds like a forecast rather than a conditional estimate. Assumptions are not stated: no future income, all active accounts including savings, and USD conversion.

Fix: Estimated runway if income stopped; show the spending period and which funds are included. Define a separate policy for history completeness: an absence of records cannot automatically mean either missing data or confirmed zero spending. This is a product question, not grounds for silently changing the formula.

Evidence: src/modules/statistics/compute-daily-averages.ts:92–128; src/modules/statistics/MoneyRunwayCard.tsx:30–35.
Suggested command: impeccable clarify; make a separate decision about history completeness.

### [P1] The product's main answer has secondary visual weight

Runway is the third equally weighted card, after income and spending. On mobile, Runway / 1y 2mo, the balance and the spending rate are hidden behind a tap. The page first invites users to inspect activity rather than understand financial capacity.

Fix: Make runway the first reading point, with the available balance and spending as its explanation. Preserve compactness and quick chart access rather than returning to three tall mobile cards.

Evidence: src/routes/statistics.tsx:74–108; src/modules/statistics/MoneyRunwayCard.tsx:43–60; PRODUCT.md.
Suggested command: impeccable layout.

### [P1] The chart's cumulative nature is unexplained

The labels are Spending trend and the tooltip Day 2 / $1,980.00. In the fixture, day-two spending is $480, while $1,980 is the two-day total. A rising line could be interpreted as an increase in daily spending. A precise amount does not compensate for ambiguity about its meaning.

Fix: Cumulative spending; tooltip Spent through Sep 2; the selected month's total and a separate Spending by category heading.

Evidence: src/modules/statistics/SpendingTrendCard.tsx:67–73,114–140; src/modules/statistics/CategoryBreakdownCard.tsx:15–20.
Suggested command: impeccable clarify.

### [P2] The accessible interface loses an important part of the summary

Accessibility tree: the mobile buttons Show Income per day details, Show Spending per day details and Show money runway details omit current amounts/duration. The month is a combobox without an accessible name; the chart is an unnamed application; the spending popover is an unnamed dialog. There is no main or h1. Screen reader users must open cards to obtain the summary. Chart keyboard interaction and Escape were tested and work; do not describe this as a keyboard failure.

Fix: Include values in accessible names/descriptions, label the month and chart, associate the popover with its heading, and add a main page region.

Evidence: src/modules/statistics/DailyAverageCard.tsx:33–77; MoneyRunwayCard.tsx:49–56; SpendingTrendCard.tsx:113–146; src/routes/statistics.tsx:115–122; src/components/Popover.tsx:37–46; src/components/PageContainer.tsx:8–9.
Suggested command: impeccable harden, then a targeted impeccable audit.

### [P2] A fixed scale compresses small spending amounts

For a fixture with $12.34 spending, the axis spans $0–$500 and the desktop curve is about 6.17 px high. The data renders but looks almost flat. The cause is a lower bound on the scale maximum.

Fix: Use an adaptive rounded maximum based on the data and a separate reasonable scale for an empty month.

Evidence: src/modules/statistics/SpendingTrendCard.tsx:33–36,92–94,129–135.
Suggested command: impeccable polish.

## Nielsen Heuristics

Expert scale of 0–4; all ten apply.

| #   | Heuristic                       | Score | Main observation                                           |
| --- | ------------------------------- | ----: | ---------------------------------------------------------- |
| 1   | Visibility of system status     |     3 | The period is visible; data completeness is unexplained    |
| 2   | Match with the real world       |     2 | The cumulative chart and runway assumptions are unclear    |
| 3   | User control and freedom        |     3 | URL filters and dismissible menus/popovers                 |
| 4   | Consistency                     |     3 | A good system with size and typography deviations          |
| 5   | Error prevention                |     2 | Incomplete history could be mistaken for low spending      |
| 6   | Recognition rather than recall  |     2 | Users must assemble the calculation context themselves     |
| 7   | Efficiency                      |     3 | Quick switching and keyboard chart navigation              |
| 8   | Aesthetic and minimalist design |     3 | Clean, but priorities do not reflect the product's purpose |
| 9   | Errors and recovery             |     2 | Empty states offer no next step                            |
| 10  | Help and explanations           |     2 | Average details exist; runway methodology is unclear       |
|     | Total                           | 25/40 | A good foundation with substantial interpretation gaps     |

## Cognitive Load and Emotional Journey

Load is moderate. Three periods are easy to scan; the difficulty is independently connecting the balance, period, spending and runway. No decision point in the fixture had more than four visible action options. Categories are data, not action options. Cognitive weaknesses: no single focus, insufficient hierarchy and a need to remember context from adjacent cards/popovers.

The first impression is calm and control. The emotional weakness is that the safety horizon changes substantially after switching periods without explanation. The page ends with categories rather than a clearer understanding of financial capacity.

## Persona Red Flags

- Alex, experienced user: can switch periods quickly but cannot verify the included funds or the chart's meaning as quickly.
- Sam, screen reader user: current mobile summary values are missing from button names; the month and chart are unnamed.
- Casey, using a phone on the go: the overview is compact, but details are necessary to understand the estimate; actual period buttons are smaller than their outer group.

## Minor Observations

- 3M/6M/1Y are 34 px tall inside a 44 px group; below the DESIGN.md standard, but not claimed as a WCAG AA violation. AveragePeriodToggle.tsx:26–34.
- Monetary headline values use sans while categories use mono: an inconsistency with Figures Register.
- For multicurrency statistics, explicitly name USD rather than using $ alone.
- Empty states offer no next step; No spending in this period to burn it is less clear than explaining why runway cannot be estimated.
- Long categories use truncate; the issue was not reproduced with the tested names.

## Detector and Evidence Limits

CLI: node .agents/skills/impeccable/scripts/detect.mjs --json src/routes/statistics.tsx src/modules/statistics → [], 0 findings.

Browser detector: each viewport produced 8 groups / 9 occurrences / 5 rules: dark-glow (2), clipped-overflow-container (3), layout-transition (2), ai-color-palette (1), gradient-text (1). These signals established no defect in the statistics interface. Clipping/transition/gradient/cyan concern hidden TanStack Devtools. Warm shadows concern navigation, the sync button or a hidden popup and are permitted by DESIGN.md for floating layers. Do not add desktop/mobile counts as unique issues.

The overlay was injected, executed and visible during inspection. After inspection, the temporary server was stopped and tab B was closed. The overlay was not left running. Missing lines in early screenshots were caused by unfinished animation; do not classify this as a persistent blank-chart bug.

Assessment A: an isolated local-only dataset of 21 transactions, 2 accounts and 6 categories, with no outbox or backend records; fetch/XHR were blocked. Assessment B: the public e2e flow created a separate dev-backend user e2e-assessment-b-20260910-7c24f9d1, profile E2E Profile, account E2E Account (Current/Active/USD/initial 0), and a $12.34 expense (None/Medium/comment Assessment B synthetic statistics fixture). These test records and normal auth/sync bookkeeping remain; existing user records were unchanged. No destructive cleanup was performed.

Not inspected: real user data, VoiceOver/NVDA, full contrast, 200% zoom, 320 px, tablet, large histories or real synchronization/recovery. Code was unchanged; build/lint/tests were not run.

## Questions for the Next Step

1. Where should work begin: calculation and label clarity, runway-first hierarchy, or accessibility?
2. Scope: the three P1 issues, all five priorities, or targeted fixes without restructuring?
3. Before transaction history begins, should the product assume zero spending, treat completeness as unknown, or rely on user confirmation?
