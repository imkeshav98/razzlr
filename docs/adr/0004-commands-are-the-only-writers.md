# Commands are the only way to change a design

Nothing writes to the Yjs document directly. Every change is a command in `packages/doc`: a zod input plus a function run in one Yjs transaction, which is one undo step. The UI, shortcuts, the assistant, importers and AI jobs all call the same commands. AI jobs save their result and the editor applies it as one `design.place` command, because Yjs undo only tracks a tab's own changes and a server write could not be undone in one step.
