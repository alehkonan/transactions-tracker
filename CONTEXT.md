# Transactions Tracker

A personal finance tracker whose working data remains available and mutable without a network connection, then converges with its durable record when connectivity permits.

## Language

### Personal finance

**Account**:
A place where money or a financial asset is held, denominated in one fixed currency.
_Avoid_: Sphere, purpose

**Sphere**:
A profile-owned named financial purpose with an Operating, Funds, or Capital type, independent of the accounts holding the money. Each sphere has its own balances per currency; multiple Funds or Capital spheres may share a type, such as Funds / Thailand and Funds / Emergency reserve.
_Avoid_: Account, account group

**Sphere type**:
One of the three financial classifications Operating, Funds, and Capital, shared by spheres serving the corresponding purpose.
_Avoid_: Transaction category, account type

**Operating**:
The sphere type for everyday income and spending, including salary, groceries, transport, regular subscriptions, and utilities. Each profile has one system Operating sphere, assigned to transaction money by default.
_Avoid_: Operational

**Funds**:
The sphere type for money earmarked for specific goals or reserves, such as travel, expensive purchases, or an emergency fund.
_Avoid_: Account group

**Capital**:
The sphere type for savings and investments intended to preserve or grow wealth, tracked as monetary amounts. Asset income is recorded as separate income transactions.
_Avoid_: Account type

**Transaction**:
An event recording an actual movement of money or a change in a tracked financial asset.
_Avoid_: Allocation

**Allocation**:
A change in the amount assigned to a sphere, independent of the account holding the money. An allocation accompanying a transaction carries the same amount and currency; allocations may also occur without transactions.
_Avoid_: Account transfer

**Reallocation**:
A single operation moving an amount between spheres in the same currency without changing account balances. Its source decrease and destination increase are equal.
_Avoid_: Currency exchange, account transfer

**Transfer**:
A movement between a person's accounts, represented by linked outgoing and incoming transactions with their accompanying allocations. Both sides form one operation for editing and deletion; their currencies and amounts may differ when exchanging currencies.
_Avoid_: Reallocation

**Transaction category**:
A classification of a transaction's income or expense, separate from its sphere. Allocations have no transaction category.
_Avoid_: Sphere, allocation category

**Operating Spending**:
Actual everyday expenses attributed to Operating, excluding reservations and expenses from Funds or Capital. Refunds recorded as income do not reduce this measure; correcting the original expense changes its historical amount instead.
_Avoid_: Allocation turnover, total spending

**Runway**:
The length of time all remaining money in accounts can cover average Operating Spending, assuming no future income. Funds and Capital money remains part of the available account balance even though their expenses are excluded from the spending average.
_Avoid_: Operating-only runway

### Identity and synchronization

**User**:
A person’s authentication identity, which may be proven by one or more credentials and may own multiple financial profiles.
_Avoid_: Account, profile

**Authentication credential**:
A revocable means by which a user proves ownership of their identity. A user may hold both passkey credentials and a password credential.
_Avoid_: Login method, account

**Passkey credential**:
A public-key authentication credential held by a user; a user may hold multiple passkey credentials.
_Avoid_: WebAuthn user, passkey account

**Password credential**:
The single password-based authentication credential a user may hold in addition to any passkey credentials.
_Avoid_: Test password, local password

**Local replica**:
A user-bound copy of the working data and its pending obligations on one device, available for viewing and editing independently of server-session validity. It survives session expiry and reauthentication by the same user and is intentionally discarded on explicit sign-out or replacement by a different user.
_Avoid_: Cache, session data

**Accepted mutation**:
A mutation durably recorded by the system of record, independently of whether its returned canonical state has reached the local replica.
_Avoid_: Confirmed mutation, applied mutation

**Mutation receipt**:
Durable proof that a particular submitted intent was accepted, binding mutation identity to that intent. When acceptance encounters a different server version, the receipt also owns the immutable acceptance-time outcome needed for replay.
_Avoid_: Client acknowledgment, delivery receipt

**Settled mutation**:
An accepted mutation whose direct canonical outcome, including any conflict notice, has been durably incorporated into the local replica. Only a settled mutation may leave the local queue; broader replica convergence belongs to synchronization.
_Avoid_: Accepted mutation, delivered mutation

**Conflict notice**:
A durable, entity-level notice owned by the originating local replica when a mutation settles against a server version different from its base version. It compares the latest submitted intent with the acceptance-time canonical outcome, preserves acceptance-time profile and entity labels, coalesces while pending, and remains until explicit acknowledgment or intentional replica discard.
_Avoid_: Conflict resolution, merge result

**Conflict inbox**:
The user-wide view of every pending conflict notice in the local replica, grouped by profile. It is an acknowledgment queue, not a conflict history or resolution workflow.
_Avoid_: Conflict log, merge queue
