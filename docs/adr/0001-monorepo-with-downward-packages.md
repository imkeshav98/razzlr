# One pnpm + Turborepo monorepo; packages only point down

Razzlr is one monorepo: four TypeScript apps (web, api, sync, worker), shared packages, and one uv workspace for Python that must sit next to the models. Packages never depend on apps, and the core chain is schema → doc → renderer → editor, enforced by a lint rule, so a change can't leak sideways. The editor is a package, not a folder in the web app, so it stays client-only and testable on its own.
