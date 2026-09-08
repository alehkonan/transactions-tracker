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

4. Provision a password-authenticated test user in that database, then provide its credentials to the Playwright process as `E2E_TEST_USERNAME` and `E2E_TEST_PASSWORD`.
5. Run the suite:

   ```sh
   E2E_TEST_USERNAME=<test-user> E2E_TEST_PASSWORD=<test-password> pnpm test:e2e
   ```

The test command never creates, migrates, truncates, or otherwise manages the database schema. It
expects the configured database to be ready before Playwright starts.

Playwright stops before starting browsers if either E2E credential is absent. Its configured-user
sign-in test fails with a targeted setup error when the credentials are rejected; because the product
does not disclose whether a username exists, that result means the user is absent, has no password
credential, or the password is wrong.

The remaining stateful tests create unique `e2e-*` users, so rows accumulate in a shared development
database instead of being truncated while parallel workers are active. Use a disposable database for
CI, or remove those users manually as a separate, approved cleanup operation.

Password-authenticated specs run in Chromium, Firefox, and WebKit. Passkey-specific specs use a
separate Chromium CDP virtual-authenticator fixture and skip unsupported browsers.
