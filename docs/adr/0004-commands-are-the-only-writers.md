# Commands are the only way to change a design

Nothing writes to the Yjs document directly. Every change is a command in `packages/doc`: a zod input plus a function run in one Yjs transaction, which is one undo step. The UI, shortcuts, the assistant, importers and AI jobs all call the same commands. AI jobs save their result and the editor applies it as one `design.place` command, because Yjs undo only tracks a tab's own changes and a server write could not be undone in one step.

## Gestures

A drag runs a command on every pointer move and typing runs one per key, so other tabs see the change live. Undoing those one by one would take dozens of steps, so the editor wraps them in a gesture (`session.beginGesture()`, see GLOSSARY.md): the commands run in it are one undo step. A gesture changes only how undo groups commands; every write is still a command.

## Exception

A design may be written outside a command in three cases. In the first, right after its own undo or redo, it puts back a value that Yjs left unset because another tab overwrote the same key concurrently. It only restores a value that tab's own command replaced, and the write is untracked so it never becomes an undo step.

The second is the schema migration (#43, `migrateDoc` in `packages/doc`). A document saved at an older schema version is brought up to the current one when a tab opens it, or before its first command if the document arrives later. The migration writes only the values it changes, untracked, so no undo step holds it. It describes the same design in the new version's terms and changes nothing anyone sees. Tabs that migrate at once write the same values, so their writes merge to one result. Until a document is migrated, reading it migrates a copy in memory.

The third is compaction (#57, `compact` in `packages/doc`). Deleted layers keep their maps so undo can bring them back, and with them the document only grows. When the last connection to a design leaves, the sync server removes those maps and every override of a layer that is gone, in one ordinary Yjs change that it stores. Undo stacks live only in open tabs, so with nobody connected no undo can need them. It runs in place rather than rebuilding the document from a snapshot, because a tab coming back from offline (IndexedDB keeps its copy) must merge into the same document; a rebuilt one would duplicate or lose its edits. The one thing a tab that was cut off loses is undoing a delete it made before it was cut off. Everything else still goes through commands.
