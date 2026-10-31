# Razzlr

Ads, social posts and everyday creative for solo marketers, companies and agencies: an AI brief-to-editable-ad flow, a multi-format design editor, and the team workflow around it. Start with [CLAUDE.md](CLAUDE.md), [GLOSSARY.md](GLOSSARY.md) and [docs/adr](docs/adr).

## Develop

Needs Node 22 and pnpm 10 (`corepack enable` picks the pinned version).

```sh
pnpm install
pnpm dev --filter @razzlr/web   # http://localhost:3000
pnpm lint        # dependency direction + ESLint
pnpm typecheck
pnpm test        # Vitest
pnpm build && pnpm e2e   # Playwright (run `pnpm --filter @razzlr/e2e exec playwright install chromium` once)
```

## Layout

```
apps/web/          Next.js app shell (more apps arrive with their tickets)
packages/config/   shared tsconfig, ESLint and Vitest presets; the dependency-direction check
tests/e2e/         Playwright user flows
```

Packages only depend downward: schema → doc → renderer → editor, and never on an app. `pnpm lint:deps` enforces it (ADR-0001).

## Vercel previews

One-time setup by the repo owner: in Vercel, **Add New → Project**, import `imkeshav98/razzlr`, set **Root Directory** to `apps/web` (framework Next.js; Vercel detects pnpm and the workspace). Every pull request then gets a preview URL.
