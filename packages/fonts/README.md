# @razzlr/fonts

The font files Razzlr renders with. They are loaded from these bytes, never from the system or the browser, so Node and browser exports draw the same glyphs.

| Family | Weights | Source |
|---|---|---|
| Noto Sans | 400, 700, 800 | notofonts/latin-greek-cyrillic |
| Noto Sans Devanagari | 400, 700 | notofonts/devanagari |
| Noto Naskh Arabic | 400, 700 | notofonts/arabic |

The unhinted static TTFs were taken from `notofonts/notofonts.github.io` (`fonts/<Family>/unhinted/ttf/`) on 2026-10-30. They are under the SIL Open Font License 1.1, in `files/OFL.txt`.

To add a face, put its file in `files/` and add a row to `FONT_FACES` in `src/index.ts`.
