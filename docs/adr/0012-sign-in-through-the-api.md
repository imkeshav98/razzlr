# Sign-in goes through the API, which alone holds the WorkOS key and signs sessions

Sign-in is WorkOS AuthKit (#58). The web app's /login asks the API for WorkOS's sign-in link, with a random state it keeps in an httpOnly cookie; WorkOS sends the person back to /callback, which checks the state and hands the code to the API. The API swaps the code for the person with WorkOS, records them in `users`, and picks their workspace: the organization WorkOS signed them in to, else the one they joined first. A first sign-in makes a workspace, its WorkOS organization (named after them until onboarding renames it) and an Owner membership.

The API then signs a session token, base64url(JSON) "." HMAC-SHA256 with `SESSION_SECRET`, the same shape as sync tokens, for the user, the workspace and the WorkOS session, good for seven days. The web app keeps it in an httpOnly cookie and sends it to the API as `Authorization: Bearer`. The API honours a token only while its person is still a member of its workspace, so removing a membership ends their sessions there. Signing out deletes the cookie and sends the person to WorkOS's logout for their WorkOS session.

Roles live in `memberships`, not in WorkOS: WorkOS knows a person belongs to an organization, and Razzlr decides what an Owner, Admin, Editor or Reviewer may do. Locally and in CI the development session (`RAZZLR_DEV_SESSION=on`) still answers for a request without a valid token; sign-in is on when `WORKOS_API_KEY`, `WORKOS_CLIENT_ID` and `WORKOS_REDIRECT_URI` are set, from the environment only.

## Considered

- The web app talks to WorkOS and keeps WorkOS's sealed session: rejected. Two servers would hold the WorkOS key, and the API would have to trust the web app's word for who is asking (ADR-0009 makes the API the one owner of records).
- The API checks WorkOS access tokens on every request (JWKS): rejected for now. Each request would carry a five-minute token that needs refreshing, and the API still needs our own user and workspace; our token names both, and the membership check gives revocation.
