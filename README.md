# Dazbee

Formerly Razzlr. The local Postgres and storage (user, database, bucket and keys in `docker-compose.yml`) and the browser's offline copy of each design (IndexedDB `razzlr-design-<id>`) keep the old name, so data made before the rename still opens.

## Develop

Needs Node 22 and pnpm 10 (`corepack enable` picks the pinned version).

```sh
pnpm install
pnpm dev --filter @dazbee/web   # http://localhost:3000
pnpm lint        # dependency direction + ESLint
pnpm typecheck
pnpm test        # Vitest
pnpm build && pnpm e2e   # Playwright (run `pnpm --filter @dazbee/e2e exec playwright install chromium` once)
```

Off CI, `pnpm e2e` starts its own API (8797), sync server (1244) and web app (3110) over a `razzlr_e2e` database and a `razzlr-e2e` bucket, next to docker compose's Postgres and storage, so a run never writes into the workspace of your local site.

## Layout

```
apps/web/          Next.js app shell (more apps arrive with their tickets)
packages/config/   shared tsconfig, ESLint and Vitest presets; the dependency-direction check
tests/e2e/         Playwright user flows
```

Packages only depend downward: schema → doc → renderer → editor, and never on an app. `pnpm lint:deps` enforces it (ADR-0001).

## Vercel previews

One-time setup by the repo owner: in Vercel, **Add New → Project**, import `imkeshav98/dazbee`, set **Root Directory** to `apps/web` (framework Next.js; Vercel detects pnpm and the workspace). Every pull request then gets a preview URL.
