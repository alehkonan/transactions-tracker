# Transactions Tracker

A personal finance tracker whose working data remains available and mutable without a network connection, then converges with its durable record when connectivity permits.

## Language

**Local replica**:
A user-bound copy of the working data and its pending obligations on one device. It survives reauthentication by the same user and is intentionally discarded on explicit sign-out or replacement by a different user.
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
