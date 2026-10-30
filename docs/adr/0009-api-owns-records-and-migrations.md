# The API owns agency records and migrations; the sync server only keeps Yjs state

`apps/api` (Hono on Node) serves orgs, clients and designs from Postgres through `packages/db` (Drizzle). Every row has an org, every design a client of that org (a composite foreign key holds this in the database too), and every query is scoped by the session's org; a client or design of another org is answered with 404, as if it didn't exist. The API runs the migrations on start and creates each design together with its first Yjs state, so the sync server never opens an empty design. The sync server reads and replaces `design_states` and nothing else.

Until sign-in (#58), a development session stands in: with `RAZZLR_DEV_SESSION=on` every request is one development user of a seeded development org. The API refuses to start with it in production, and without it every route below `/clients` answers 401. The web app calls the API from its server only, so no browser talks to the API yet.

## Considered Options

- The sync server creating designs on first connection, as in phase 0: rejected, a design would exist without an org or client.
- Migrations as a separate deploy step: rejected for now; one API container is the only writer of the schema, and Drizzle's migrator skips what has run.
