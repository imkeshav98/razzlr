# Every workspace has brands; the app no longer asks who it is for

ADR-0011 gave each workspace a **kind** (solo, company or agency), asked as the first step of onboarding and changeable in settings, so an agency would call its brands "Clients". In the new-user flow review (2026-11-01) Keshav found the three choices confusing and asked for them to go.

Now the app asks nothing about who it is for. Every workspace calls its brands brands, an agency's clients included. Onboarding is one step, the first brand from its website or its name. Where the app opens depends only on how many brands there are: one opens on its brand home, two or more on the Brands page. New brand is in the crumb's brand menu on every page that has it, so a workspace that opens straight on its one brand can still add a second. Settings keeps the workspace's name.

The rest of ADR-0011 stands: a workspace with brands inside, each brand a wall.

The `kind` column and the API's `kind` field stay for now, unused by the web app, so no data is dropped; removing them is a later migration.

## Considered

- Keep the kind but ask it later, or only in settings: rejected. It still changes words in two ways, and the only thing it changed was what brands are called.
- Call brands "Clients" for everyone: rejected. A solo marketer or a company has no clients.
