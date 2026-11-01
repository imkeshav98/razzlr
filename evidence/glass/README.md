# Glass: one definition, cards blur again, lighter tint (#228)

Each surface has `NN-place-theme-before.png` (origin/main at bbc0df9) and `-after.png` (branch claude/project-thread-oad620), shot in Chromium with Playwright over the same striped test ad. `compare/` has each pair side by side. `diagnosis/` has the DevTools check on main: cards with the aside's mask (crisp ad edges through the cards) and with `fade-more` removed by hand (the blur appears). `audit-*.txt` lists every element with a backdrop filter and any ancestor that cuts its backdrop. `table.md` is the contrast table.

| File | What it shows |
|---|---|
| 00-editor-overview | Whole editor: Layers flyout and property cards over the ad |
| 01-layers-flyout | Layers flyout |
| 02-property-cards | Property cards (page selected): blur was missing before |
| 03-dock-zoom | Tool dock and zoom pill |
| 04-island-start | Top start island (logo, brand, design name) |
| 05-island-end | Top end island (Share, account) |
| 06-rail | Panel rail |
| 07-text-cards | Property cards with a text layer selected |
| 08-font-list | Font list popover inside the text card |
| 09-shape-menu | Shape menu from the dock |
| 10-share-menu | Share menu |
| 11-export-menu | Export form |
| 12-template-menu | Save as template form |
| 13-rulers | Rulers: solid strips now, no blur |
| 14-shortcuts-dialog | Shortcuts dialog and its scrim (scrim now comes from the shared glass) |
| 15-phone-sheet | Phone property sheet: one glass sheet, no double tint, no bottom fade |
| 16-phone-layers | Phone Layers sheet |
| 17-arabic-editor | Arabic, right to left, flyout and cards |
| 18-library-capsule | Library capsule on Home |
| 19-account-menu | Account menu |
| 20-brand-switcher | Brand switcher menu |
| 21-brief-formats-menu | Brief composer's formats popover on the brand home |
| 22-tile-more-button | Design tile's "more" button: shared glass instead of black/45 + blur(8px) |
| 23-tile-menu | Design tile menu |
