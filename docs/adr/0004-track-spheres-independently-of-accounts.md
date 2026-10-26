# Track spheres independently of accounts

Accounts describe where money is held in one fixed currency; Operating, Funds, and Capital describe its financial purpose with separate balances per currency across accounts. We chose global sphere balances over reservations tied to individual accounts so money reserved while held in cash can fund a purchase from a bank account without relocating the reservation between accounts.

Operating, Funds, and Capital are three sphere types, not a limit of three sphere records. Each Sphere has a type and name, allowing Funds / Thailand and Funds / Emergency reserve to hold separate balances without introducing a separate Goal entity.

A transaction is accompanied by an allocation of the same amount and currency, defaulting to Operating; allocations may also redistribute purpose without a transaction. Transaction categories remain classifications of actual income and expenses and do not apply to allocations. Operating Spending measures actual everyday expenses from Operating, so reserving money for travel and later spending it from Funds does not inflate everyday spending.

Standalone reallocations move equal amounts between spheres in one currency as one editable and deletable operation. They cannot exchange currencies: changing the currency of actual holdings requires transactions. Negative sphere balances are permitted with a warning so an insufficient reservation does not prevent recording an actual expense.

Capital initially tracks monetary amounts, with asset income entered as separate transactions. Existing transaction history and account opening balances are initially attributed to Operating; users subsequently redistribute current amounts into Funds and Capital. We do not infer historical purpose from the old Current/Savings account grouping because storage classification cannot reliably establish financial purpose.

Detailed rules, reporting, defaults, and examples are recorded in the [Sphere specification](../plans/spheres.md). Transaction/allocation lifecycle and paired transfers are covered by [ADR-0005](0005-keep-transactions-and-allocations-consistent.md).
