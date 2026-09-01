# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Individuals managing their own personal finances across multiple accounts and currencies, including while traveling or without reliable connectivity. The product is primarily a personal tool rather than a public financial service for a broad audience.

## Product Purpose

Cracker Tracker helps a person understand their financial capacity: how much remains across current and savings accounts, and how long those funds could sustain their present spending if their sources of income stopped.

It also provides dependable personal bookkeeping. The complete working set remains available and editable without a network connection, then synchronizes with the durable record when connectivity permits.

Success means the user can quickly understand both their current financial position and their estimated runway, while trusting that everyday records remain usable regardless of connectivity.

## Positioning

Cracker Tracker is organized around financial runway rather than transaction capture alone. It combines balances across current and savings accounts with observed spending to answer a concrete personal question: how long the user's available funds could last if income disappeared.

Its offline-first mechanism is part of that promise: records, filters, statistics, and imports operate from a complete local replica instead of depending on a live server response.

## Operating Context

Users maintain separate financial profiles, accounts, categories, and income, expense, and transfer transactions. They may hold funds in multiple currencies and distinguish current funds from savings.

The recurring workflow is to record or import transactions, review current and savings balances, inspect spending statistics, and estimate the available financial runway. The product must remain useful during travel, unreliable connectivity, and periods with no connection.

## Capabilities and Constraints

- Separate profiles under one authenticated account, each with its own accounts, categories, and transactions.
- Current and savings accounts, including active and archived accounts.
- Multi-currency bookkeeping with USD-normalized aggregate statistics.
- Income, expense, and transfer transactions with categories and necessity levels.
- Search and filtering by account, category, and date range.
- Statistics for daily income and spending, monthly spending trends, category breakdown, and financial runway.
- CSV import and export.
- Passkey-only authentication.
- Offline-first reads and mutations through a complete local replica, with automatic synchronization when connectivity returns.
- Simple last-write-wins conflict handling for concurrent edits; the product reports conflicts but does not provide field-level merging.
- The interface language is English only for now.

## Brand Commitments

- The product name is **Cracker Tracker**.
- The product identity should evoke a cracker biscuit. This is a binding visual constraint, but its specific palette, typography, materials, and component treatment belong in the design system rather than this product record.

## Evidence on Hand

- The implemented product and feature inventory in `README.md` and `src/routes/`.
- The offline-first architecture, synchronization behavior, and measured operating characteristics in `docs/architecture.md`.
- Known infrastructure and reliability constraints in `docs/limitations.md`.
- Existing working features for accounts, transactions, statistics, profiles, categories, CSV import/export, synchronization, and passkey authentication under `src/modules/`.
- A committed PWA manifest and application icons under `public/`.
- No testimonials, customer claims, public usage figures, pricing, benchmarks, or third-party endorsements are currently established; future work must not fabricate them.

## Product Principles

1. **Show capacity, not just activity.** Turn balances and spending into an understandable estimate of how long available funds can sustain the user.
2. **Keep the full financial position legible.** Make current funds, savings, currencies, and spending behavior understandable together rather than as disconnected records.
3. **Remain useful without connectivity.** Core bookkeeping, filtering, statistics, and imports must continue to work from the local replica.
4. **Preserve trust through explicit state.** Make synchronization progress, unsaved changes, stale data, and conflicts visible rather than implying certainty the system does not have.
5. **Prefer practical personal control over financial-service complexity.** Keep conflict handling and workflows proportionate to a personal finance tool while preserving durable records and ownership boundaries.
