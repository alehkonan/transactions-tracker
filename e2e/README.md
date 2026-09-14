# End-to-end tests

These tests exercise the built application through a fresh `vite preview` server. They cover browser
behavior that unit tests cannot reach: the boot gate, IndexedDB, BroadcastChannel, Web Locks,
local-first writes, public sync transport, authentication, PWA startup, and responsive UI.

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

4. Optionally provide `E2E_TEST_USERNAME` and `E2E_TEST_PASSWORD` to exercise the configured-user sign-in smoke. Stateful acceptance tests create unique disposable users through the public UI.
5. Run either the whole suite or a category:

   ```sh
   E2E_TEST_USERNAME=<test-user> E2E_TEST_PASSWORD=<test-password> pnpm test:e2e
   pnpm exec playwright test e2e/local-first
   pnpm test:e2e:pwa
   ```

The single `playwright.config.ts` always creates a fresh production build and starts
`vite preview` on port 5455. Test files are grouped by behavior:

- `auth/` — sign-in, sign-out obligations, same-owner password/passkey reauthentication, and transition fencing;
- `local-first/` — IndexedDB migration, boot, offline writes, owner admission, storage/network faults, staged refresh, and cross-tab fencing;
- `pwa/` — service-worker installation, cold offline startup, anonymous-shell isolation, cache repair, and passive A/B updates;
- `sync-protocol/` — observable `/api/push` protocol behavior;
- `ui/` — responsive browser workflows.

The test command never creates, migrates, truncates, or otherwise manages the database schema. It
expects the configured database to be ready before Playwright starts.

The configured-user sign-in test is skipped if either E2E credential is absent. When configured, it
fails with a targeted setup error if the credentials are rejected; because the product does not
disclose whether a username exists, that result means the user is absent, has no password credential,
or the password is wrong.

The remaining stateful tests create unique `e2e-*` users, so rows accumulate in a shared development
database instead of being truncated while parallel workers are active. Use a disposable database for
CI, or remove those users manually as a separate, approved cleanup operation.

The configured project currently runs Chromium. Passkey-specific specs use a CDP virtual
authenticator fixture.
