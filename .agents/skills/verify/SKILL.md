---
name: verify
description: How to launch and drive transactions-tracker for manual verification — dev server, profile-selection gotcha, and driving the browser with playwright-cli. Activate when verifying a UI/route change actually works, before reporting a task done.
---

# Verifying transactions-tracker

Drive the real app in a real browser — don't stop at `pnpm typecheck`/`pnpm lint`, they don't prove a UI change works.

## Drive with `playwright-cli`, not the raw Playwright MCP tools

This repo has the `playwright-cli` skill installed (`playwright-cli` on `PATH`). Use it for ad-hoc manual verification —
`open`/`goto`/`click`/`snapshot`/`screenshot`/`console`. The `mcp__playwright__*` tools work too if `playwright-cli` is
ever unavailable, but default to `playwright-cli` since it's this repo's documented driver (see its own skill for the
full command reference). Neither is for authoring `e2e/` test files — that's a separate, heavier task.

## Dev server

```bash
curl -sf -o /dev/null http://localhost:5454 || pnpm dev &
```

Port 5454 (see `CLAUDE.md`). A dev server from a previous session is often still running in this environment — check
before starting a second one, or you'll hit `EADDRINUSE`.

## Gotcha: every route redirects to `/profile` until a profile is selected

`src/routes/__root.tsx`'s `beforeLoad` redirects any route to `/profile` if no profile cookie is set. A fresh
`playwright-cli` browser session (in-memory by default) always starts logged out of any profile. Select one before
navigating anywhere else:

```bash
playwright-cli open http://localhost:5454/transactions
# → redirected to /profile; snapshot it, then click a profile card (there's usually a seeded "Test" profile)
playwright-cli snapshot
playwright-cli click <ref of the profile button>
playwright-cli goto http://localhost:5454/transactions
```

Use `--persistent` (or `--profile=<dir>`) on `open` instead if you want the profile selection to survive across runs.

## Representative interaction

Screenshots go under `.temp/` (gitignored), never the repo root:

```bash
mkdir -p .temp
playwright-cli screenshot --filename=.temp/check.png
```

Then read the saved PNG with the Read tool — don't just trust the command exited 0.

## Gotcha: locale-dependent formatting breaks hydration — check with a direct SSR load

This is a full-stack SSR app (TanStack Start). Any component that formats a `Date` with `toLocaleDateString`/
`toLocaleString`/`Intl.DateTimeFormat` **without an explicit locale** can render different text on the server (Node's
locale) than the client (the browser's locale), which React flags as a hydration mismatch. Client-side navigations
(`playwright-cli click` on an in-app link) won't catch this — the component only renders server-side on a real
full-page load. Always verify at least once via a direct `goto`/`open` to the URL under test (including any query
params the change reads), then check the console:

```bash
playwright-cli goto "http://localhost:5454/transactions?from=2026-08-04&to=2026-08-04"
playwright-cli console error
```

A clean run has zero entries. `Hydration failed because the server rendered text didn't match the client` means some
formatter needs a pinned locale (e.g. `toLocaleDateString("en-US", …)` instead of `toLocaleDateString(undefined, …)`).

## Cleanup

```bash
playwright-cli close
rm -rf .playwright-cli .temp   # don't leave verification screenshots/snapshots in the repo root
```
