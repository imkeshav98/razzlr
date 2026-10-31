# The API owns workspace records and migrations; the sync server only keeps Yjs state

`apps/api` (Hono on Node) serves workspaces, brands and designs from Postgres through `packages/db` (Drizzle). Every row has a workspace, every design a brand of that workspace (a composite foreign key holds this in the database too), and every query is scoped by the session's workspace; a brand or design of another workspace is answered with 404, as if it didn't exist. (These were orgs and clients until ADR-0011.) The API runs the migrations on start and creates each design together with its first Yjs state, so the sync server never opens an empty design. The sync server reads and replaces `design_states` and nothing else.

Until sign-in (#58), a development session stands in: with `RAZZLR_DEV_SESSION=on` every request is one development user of a seeded development workspace. The API refuses to start with it in production, and without it `/workspace` and every route below `/brands` answer 401. The web app calls the API from its server only, so no browser talks to the API yet.

## Considered Options

- The sync server creating designs on first connection, as in phase 0: rejected, a design would exist without a workspace or brand.
- Migrations as a separate deploy step: rejected for now; one API container is the only writer of the schema, and Drizzle's migrator skips what has run.
