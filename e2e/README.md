# End-to-end tests

These tests exercise browser behavior that unit tests cannot reach: the boot gate, IndexedDB,
BroadcastChannel, Web Locks, local-first writes, and a real server-function round trip.

## Local prerequisites

1. Configure the variables from `.env.example` in a local, uncommitted `.env` file.
2. Start Postgres:

   ```sh
   docker compose up -d db
   ```

3. Run the suite:

   ```sh
   pnpm test:e2e
   ```

`global-setup.ts` applies pending migrations before the tests run. Each test creates a unique `e2e-*`
user, so rows accumulate in a shared development database instead of being truncated while parallel
workers are active. Use a disposable database for CI, or remove those users manually as a separate,
approved cleanup operation.

The current specs require Chromium because they use its CDP virtual authenticator. Firefox and WebKit
projects remain configured for future tests and skip these authentication-dependent specs.
