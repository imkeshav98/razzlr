# Commands are the only way to change a design

Nothing writes to the Yjs document directly. Every change is a command in `packages/doc`: a zod input plus a function run in one Yjs transaction, which is one undo step. The UI, shortcuts, the assistant, importers and AI jobs all call the same commands. AI jobs save their result and the editor applies it as one `design.place` command, because Yjs undo only tracks a tab's own changes and a server write could not be undone in one step.

## Gestures

A drag runs a command on every pointer move and typing runs one per key, so other tabs see the change live. Undoing those one by one would take dozens of steps, so the editor wraps them in a gesture (`session.beginGesture()`, see GLOSSARY.md): the commands run in it are one undo step. A gesture changes only how undo groups commands; every write is still a command.

## Exception

A session may write outside a command in one case: right after its own undo or redo, it puts back a value that Yjs left unset because another tab overwrote the same key concurrently. It only restores a value that tab's own command replaced, and the write is untracked so it never becomes an undo step. Everything else still goes through commands.
