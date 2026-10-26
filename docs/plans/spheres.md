# Spheres

Status: Domain model confirmed by the user. Application implementation has not started.

## Purpose

Separate where money is held from what it is intended for. Reserving and spending money for a large purchase must preserve actual account movements without inflating the cost of everyday life.

## Accounts and spheres

- An account is a place where money is held, with one fixed currency. Remove Current/Savings classification and account grouping; keep a flat list with an archive filter.
- Archiving an account does not remove its money. Its balance continues to contribute to sphere coverage and Runway.
- A Sphere belongs to a financial profile and has a name and one of three types: Operating, Funds, or Capital.
- Each profile starts with one system Operating sphere, which cannot be deleted or archived. It must remain available for default transaction allocations and opening-balance adjustments. Users create named Funds and Capital spheres as needed; all three types are available immediately.
- Examples: Funds / Thailand, Funds / Emergency reserve, Capital / Deposit. These are Sphere records, not separate Goal entities or transaction categories.
- Each sphere holds balances in any number of currencies, independently of accounts. Cash reserved for Thailand can cover a bank-card purchase from the Thailand sphere in the same currency.
- A sphere may be renamed, but its type cannot change. A used Funds or Capital sphere may be archived only when every currency balance is zero; its history is retained. Only unused spheres may be deleted, except for the system Operating sphere, which cannot be deleted.
- Capital tracks monetary amounts only. Asset income is entered as separate income transactions; quantities of securities and asset revaluation are outside this version.

## Transactions and allocations

A transaction records actual money movement or a change in a tracked financial asset. Each transaction has an accompanying allocation of the same signed amount and currency. Categories belong to transactions; allocations have no categories.

| Operation              | Account effect                            | Sphere effect                                               |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| Income                 | Increase the receiving account            | Increase the selected sphere                                |
| Expense                | Decrease the paying account               | Decrease the selected sphere                                |
| Account transfer       | Outgoing and incoming transaction records | One allocation for each transaction record                  |
| Reallocation           | None                                      | Equal decrease and increase between spheres in one currency |
| Opening-balance change | Adjust the account opening balance        | Assign the difference to Operating                          |

For income, the external source has no owned account or sphere; for expense, the external destination has no owned account or sphere. The interface expresses this through Income and Expense rather than asking users to select null endpoints.

Income and expense default to Operating. Both sides of an account transfer independently default to Operating and may each be changed by the user; choosing the source sphere does not automatically change the destination sphere. A standalone reallocation explicitly selects both source and destination spheres.

An account transfer may preserve purpose or change it at the same time. A same-currency transfer within the same sphere cancels out at sphere level. A currency exchange decreases the source currency and increases the destination currency in the selected spheres.

## Consistency and lifecycle

- For each profile and currency, total sphere balances equal total actual account balances, including opening balances and archived accounts.
- Negative sphere balances are allowed with a warning. Insufficient reserves must not prevent recording an actual expense.
- A transaction and its allocation are created, edited, and deleted together. Amount, currency, and date changes propagate to the allocation.
- New account transfers retain two linked transaction records. Both sides and their allocations are edited and deleted as one operation.
- Same-currency transfer amounts must match. Record fees as separate expenses with their own categories and spheres. For currency exchanges, enter both amounts independently.
- A standalone reallocation is one editable and deletable operation. Its source decrease equals its destination increase in the same currency; it cannot exchange currencies or alter account balances.
- Changing an account's opening balance assigns the difference, positive or negative, to Operating.

## Reporting

- Operating Spending counts actual Expense transactions whose accompanying allocation belongs to Operating. Transfers and standalone reallocations do not count; expenses from Funds and Capital do not count.
- Refunds are ordinary Income transactions. They increase the selected account and sphere without reducing Operating Spending. A user who wants to correct a past expense may edit that expense instead, changing its historical amount.
- Runway uses all actual remaining account money, including archived accounts and money assigned to Funds or Capital, divided by average Operating Spending. It does not restrict the numerator to Operating balances.
- Original amounts and sphere balances remain in their currencies. Retain the existing shared exchange-rate conversion for combined reporting and label combined totals as approximate. Historical converted figures can change when exchange rates change.

The classification of a negative allocation alone is insufficient to calculate Operating Spending: an expense and the outgoing side of a transfer or reallocation have different reporting meanings. Reports must retain that distinction.

## Existing data

- Attribute existing transaction history and account opening balances to the profile's Operating sphere.
- Do not infer historical purpose from Current/Savings account types. Users redistribute current balances into named Funds and Capital spheres afterward.
- Preserve legacy unlinked transfer records independently, with one Operating allocation per record. New transfers require pairing; old sides may be paired manually, but migration must not guess pairs.
- Preserve existing transaction categories and transaction amounts.

## Example

All amounts below are USD; account money is aggregated across the profile's accounts.

| Event                         | Account money | Operating | Funds / Thailand | Operating Spending |
| ----------------------------- | ------------: | --------: | ---------------: | -----------------: |
| Salary +3000                  |          3000 |      3000 |                0 |                  0 |
| Reserve 1200 for Thailand     |          3000 |      1800 |             1200 |                  0 |
| Groceries −800 from Operating |          2200 |      1000 |             1200 |                800 |
| Flights −1200 from Thailand   |          1000 |      1000 |                0 |                800 |
| Refund +100 into Operating    |          1100 |      1100 |                0 |                800 |

## Decisions

- [ADR-0004: Track spheres independently of accounts](../adr/0004-track-spheres-independently-of-accounts.md)
- [ADR-0005: Keep transactions and allocations consistent](../adr/0005-keep-transactions-and-allocations-consistent.md)
