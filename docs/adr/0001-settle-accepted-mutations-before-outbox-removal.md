# Settle accepted mutations before outbox removal

A server receipt makes a mutation **accepted**, but not **settled**. An accepted mutation may leave the local outbox only after one shared settlement module has durably incorporated its direct canonical rows, colors, and any conflict notice into the originating local replica; broader convergence remains the pull protocol's responsibility. Foreground and service-worker delivery must cross this same seam, and incompatible worker protocols fail closed rather than falling back to acknowledgment-only removal.

## Consequences

Mutation receipts bind each mutation identity to its submitted intent and retain an immutable acceptance-time conflict outcome when the mutation settles against a different server version. The originating outbox retains the submitted intent until settlement, so receipts store an intent fingerprint rather than duplicating the full submission; pre-upgrade receipts are grandfathered because their missing history cannot be reconstructed. Conflict notices are device-local, durable until explicit acknowledgment or intentional replica discard, coalesced by entity, and exposed through a user-wide inbox. This costs additional receipt storage and protocol complexity in exchange for preventing accepted writes from discarding canonical state or conflict information before the local replica has secured them.
