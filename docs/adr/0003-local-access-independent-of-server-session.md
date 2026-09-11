# Keep local access independent of the server session

A previously established local replica remains available for viewing and editing when the server session expires, is rejected, or cannot be checked because the network or server is unavailable. Server authentication and ownership authorization remain mandatory for synchronization and other server-owned operations, but are not prerequisites for opening the local workspace; reauthentication by the same user preserves its pending obligations.

## Consequences

- This deliberately favors offline availability on the device over requiring a fresh server authorization before every display of already downloaded data. A remote session revocation cannot immediately revoke offline access to that data.
- Local access is not local encryption or proof of the identity of the person currently holding an unlocked device. Additional device-local protection is a separate feature.
- Session expiry and explicit sign-out are different actions. Expiry must not discard the replica; explicit sign-out or deliberate replacement must prevent the next user from inheriting the previous user's financial data or pending obligations.
- The implementation must distinguish the owner of the local replica from the currently authenticated server user. A different server identity must never receive mutations originating from the old replica.

Implementation plan: [Local-first PWA startup and reauthentication](../plans/local-first-pwa-startup.md). The decision is accepted; the linked implementation is planned, not yet shipped.
