# Netlify Database provider research

Researched on 2026-10-27. This is a planning record; no database was provisioned or changed. The user explicitly accepts an empty database and does not require existing data to be transferred. Credit exhaustion is accepted for this pet project and does not constrain the recommendation.

## Findings and recommendation

Keep the existing `postgres` driver and `drizzle-orm/postgres-js` adapter, add `@netlify/database` for environment-specific connection discovery, and preserve the repository's Drizzle migration workflow. This is an inference from the supported driver interfaces and the existing code, not a deployed compatibility result.

| Topic             | Verified finding                                                                                                                        | Consequence for this repository                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Free plan         | Netlify's credit-based Free plan explicitly includes Database. Legacy plans are distinct.                                               | Confirm the team's plan type; no paid upgrade is part of this plan. [Pricing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/) |
| Drivers           | Any PostgreSQL-compatible driver is supported; the docs give a `postgres` example. `NETLIFY_DB_URL` is exposed to builds and functions. | Preserve the stable driver instead of combining a provider switch with an ORM upgrade. [Tooling](https://docs.netlify.com/build/data-and-storage/netlify-database/tooling/)                            |
| Branch selection  | `getConnectionString()` resolves the appropriate database branch for the current environment.                                           | Resolve lazily inside the server-only database boundary; never hardcode the production URL into preview configuration. [API](https://docs.netlify.com/build/data-and-storage/netlify-database/api/)    |
| Location          | Database creation defaults to the site's functions region.                                                                              | The documented Ohio/Tokyo separation can plausibly disappear; verify the provisioned region and measure actual latency. [API](https://docs.netlify.com/build/data-and-storage/netlify-database/api/)   |
| Preview isolation | Deploy previews receive a branch copied from production.                                                                                | Rehearse schema setup and new-account flows on a preview; preview-created data does not migrate to production. [Overview](https://docs.netlify.com/build/data-and-storage/netlify-database/)           |

The native `drizzle-orm/netlify-db` example uses beta Drizzle packages. That adapter is unnecessary for the selected standard-driver path. Keep existing package versions unless a specific compatibility failure demonstrates a need to change them. [Tooling](https://docs.netlify.com/build/data-and-storage/netlify-database/tooling/)

## Migration ownership

Netlify explicitly permits an external migration system. Keep `src/database/migrations/` outside its automatically detected `netlify/database/migrations/` directory, with one migration ledger and one runner. Preview migrations can run during the build. Production migrations require an explicit process before publication: Netlify offers no arbitrary publish-time hook for custom runners. Use backward-compatible changes and make failed migration execution block the release. [Migrations](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/)

This preserves the repository's `db:generate` followed by `db:migrate` rule. The bundled Netlify skill instead imposes automatic deployment migrations as a house rule; the repository's explicit instruction takes priority. Do not mix the two migration engines, and never use schema push.

## Empty database setup and client isolation

Provision an empty target and replay the repository's committed migrations using the selected Drizzle runner. Verify that the history builds all tables, indexes, constraints, and triggers from nothing. Create new users through the application's normal authentication flow. Source dumps, data restoration, trigger suspension for imports, and data-preserving cutover are out of scope.

An empty backend represents a new dataset, not merely a new connection URL. Old IndexedDB rows, outbox mutations, and session cookies must not be accepted as belonging to it. Numeric user IDs may be reused, so matching an old owner ID is insufficient. The implementation plan should introduce a fresh client-storage namespace, reject the old sync protocol before processing its payload, and rotate the session signing secret. Existing installed PWAs and stale tabs must remain unable to replay old mutations after the switch. These requirements follow from the repository's replica ownership and signed-session architecture; they are application design conclusions, not Netlify features. See [architecture](../architecture.md).

Any rollback must retain this dataset boundary. Reverting the URL or storage namespace alone could reconnect fresh and old identities incorrectly. Source teardown is a separate operational step after the new deployment is verified.

## Development and unresolved checks

Netlify offers a local PostgreSQL-compatible engine through `netlify dev` or `@netlify/vite-plugin`. It has one local database and is unsuitable for representative load tests. The existing local PostgreSQL setup can remain the initial workflow; adding another Vite plugin is not required for this provider change. [Local development](https://docs.netlify.com/build/data-and-storage/netlify-database/local-development/)

Before cutover, verify actual PostgreSQL version, TLS certificate validation, target pooling behavior, transaction timeout support, first-preview URL availability, complete migration replay, and old-client rejection. Preserve the existing transaction boundaries and deadlines. Compare cold and warm sync measurements; co-location cannot eliminate framework cold starts or excessive query round trips.

Documentation caveats: Netlify's knowledge-base FAQ incorrectly says the free plan is unavailable, conflicting with the explicit pricing page cited above. Some database pages still describe storage pricing relative to July 2026; no current free-storage guarantee is inferred. The Supabase changelog Markdown endpoint could not be fetched by the web tool; no Supabase feature is being implemented in this research. The Netlify setup connector was checked successfully and returned installation guidance only.
