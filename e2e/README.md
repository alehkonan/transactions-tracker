# End-to-end tests

These tests exercise browser behavior that unit tests cannot reach: the boot gate, IndexedDB,
BroadcastChannel, Web Locks, local-first writes, and a real server-function round trip.

## Local prerequisites

1. Configure the variables from `.env.example` in a local, uncommitted `.env` file.
2. Start Postgres:

   ```sh
   docker compose up -d db
   ```

3. Prepare the database explicitly when its schema changes:

   ```sh
   pnpm db:migrate
   ```

4. Run the suite:

   ```sh
   pnpm test:e2e
   ```

The test command never creates, migrates, truncates, or otherwise manages the database schema. It
expects the configured database to be ready before Playwright starts.

Each test creates a unique `e2e-*` user, so rows accumulate in a shared development database instead
of being truncated while parallel workers are active. Use a disposable database for CI, or remove
those users manually as a separate, approved cleanup operation.

Password-authenticated specs run in Chromium, Firefox, and WebKit. Passkey-specific specs use a
separate Chromium CDP virtual-authenticator fixture and skip unsupported browsers.
