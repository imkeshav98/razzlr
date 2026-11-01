# Dazbee

A web app where a solo marketer, a company's team or a digital marketing agency makes everything a brand needs: ads in every size, social posts and everyday creative. It joins an AI flow (brief to editable ad), a design editor built for many formats and variants, and the team workflow (brand kits, approval, publishing). Each sign-up is a workspace with brands inside; an agency's clients are brands too (ADR-0011, ADR-0013).

Read `GLOSSARY.md` before naming anything, and the ADRs in `docs/adr/` before changing an area they cover.

## Layout

pnpm + Turborepo monorepo. `apps/` deploy (web, api, sync, worker); `packages/` are shared code and only ever depend downward: schema → doc → renderer → editor. `tests/` holds cross-app suites (Playwright). `python/` is one uv workspace for model-adjacent work (phase 2). See ADR-0001.

## Rules

- Every document type and job contract is defined once in `packages/schema` (zod). Generated files are never edited by hand.
- Nothing writes to the Yjs document except a **command** in `packages/doc`. One command is one undo step, or one gesture (a drag, a typing session) is, for the commands it runs (ADR-0004).
- Exports are drawn on the CPU surface only. Never add an export path that reads pixels from WebGL.
- Fonts and images are loaded from bytes we control, never from the system or the browser's decoder.
- Never put server addresses or secrets in the repo.

## Pull requests

One ticket, one PR, closing its issue. Keshav's standing rule: merge your own PR (merge commit, not squash) as soon as CI is green on its head; he reviews after merge. GitHub auto-merge needs branch protection, which this private repo can't have on the Free plan (checked via the API on 2026-10-30).

Test every user-facing feature in a real browser (Playwright on Chromium) and put the evidence in the PR: screenshots, numbers, the test cases run. Only ask Keshav when a decision is needed.

## Agent skills

Matt Pocock's skills are vendored in `.claude/skills/` (MIT, source commit in `.claude/skills/.source-commit`). Start with `/ask-matt` if unsure which flow fits.

### UI/UX Pro Max

Use `ui-ux-pro-max` (vendored in `.claude/skills/ui-ux-pro-max`, MIT, source commit in its `.source-commit`) for any work that changes how the app looks or is interacted with: the editor UI, panels, dashboards, review pages. It is not for the renderer or document model. Its `SKILL.md` names the search script with `${CLAUDE_PLUGIN_ROOT}`; in this repo run `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <domain>` from the repo root.

### Issue tracker

Issues and specs live in GitHub Issues on imkeshav98/dazbee. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
