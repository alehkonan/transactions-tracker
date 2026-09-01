# Support passkey and password credentials

Users may hold multiple passkey credentials and at most one password credential, all of which authenticate the same user through the existing session system. We chose normal per-user password credentials instead of a test-only bypass or shared development secret so cross-browser end-to-end tests and physical-device development exercise the same authentication flow available to users; authentication credentials remain server-owned and never enter the offline replica.

## Consequences

Passwords use an intentionally expensive password KDF and introduce durable rate limiting for public password registration and sign-in. Users manage both credential types from Settings, the server transactionally prevents removal of a user's final credential, and password changes or credential removal revoke other refresh sessions while already-issued access tokens may remain valid for up to one hour.
