# One Yjs document per design; feeds and translations outside it

All pages and formats of a design live in one Yjs document, because masters and spanning layers need every page together. Layers are a flat map with a parent id and a fractional index so moves merge cleanly. Feed rows, variant values, translations and comments live in Postgres and are referenced by id, so a 200-row feed doesn't slow every edit.

## Considered Options

- One document per page: rejected, masters and spanning layers would cross documents.
