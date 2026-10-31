# Razzlr is for solo users, companies and agencies: a workspace each, brands inside

Razzlr started agency-first: an org was an agency, and every design belonged to one of its clients. Keshav chose not to lock Razzlr to agencies (option A in the [tenancy options](https://claude.ai/artifact/53KcdqMDCoEkxepn1nYJG6), 2026-10-30), so a solo user or a company can use it directly too.

Every sign-up gets a **workspace**: who pays, its seats and its AI credits. The work inside a workspace is organised by **brand**: a brand has its brand kit, designs, assets and feeds, and later its publishing accounts and reviewers. A solo user has one brand (their business), a company a few (product lines, regions), an agency one per client. The workspace's **kind** (`solo`, `company` or `agency`), asked at onboarding, changes defaults and words only, never the data: an agency workspace calls its brands "Clients", the others "Brands". A person can belong to several workspaces.

The brand stays the wall the client was: every row has a workspace, every design and asset a brand of that workspace (composite foreign keys), and every query is scoped by the session's workspace, with another workspace's brand answered as 404. Seats, memberships and roles (Owner, Admin, Editor, Reviewer, with an Editor optionally limited to some brands) arrive with sign-in (#58).

## Considered Options

- A personal space per person plus teams, with brand kits as libraries any design applies (Canva, Figma): rejected. Two kinds of owner on every row and query, sharing per design, and a soft wall between an agency's clients.
- An account above workspaces above brands (Canva and Figma Enterprise): not now. It can be added later as a level above workspaces without changing what is below.
