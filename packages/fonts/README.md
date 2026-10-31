# @razzlr/fonts

The font files Razzlr renders with. They are loaded from these bytes, never from the system or the browser, so Node and browser exports draw the same glyphs.

| Family | Weights | Version | Source |
|---|---|---|---|
| Noto Sans | 400, 700, 800 | 2.015 | notofonts/latin-greek-cyrillic |
| Noto Sans Devanagari | 400, 700 | 2.007 | notofonts/devanagari |
| Noto Naskh Arabic | 400, 700 | 2.021 | notofonts/arabic |

The unhinted static TTFs were taken from `notofonts/notofonts.github.io` (`fonts/<Family>/unhinted/ttf/`) on 2026-10-30. They are under the SIL Open Font License 1.1, in `files/OFL.txt`.

To add a face, put its file in `files/` and add a row to `FONT_FACES` in `src/index.ts`.

## Google Fonts

`src/google.ts` lists the Google Fonts families Razzlr offers, with their weights (#50). They are not in this package: `pnpm --filter @razzlr/api fonts:google` copies them from Google into our storage, with the API's settings, and from then on they load from there like a brand's uploads. Run it once per environment, and again after adding a family to the list. Name families to copy only those, as in `pnpm --filter @razzlr/api fonts:google Inter "Bebas Neue"`.
