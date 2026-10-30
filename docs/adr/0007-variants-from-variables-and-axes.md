# Variants come from variables and axes, not feed columns

Layers bind properties to typed variables; a variant is one combination of values along axes (product, message, audience, language). A feed is just one source of axis values. Overrides resolve most specific first: format within a variant, variant, variable, page, format, base.

## Considered Options

- Layers bound straight to feed columns, one variant per row (Stunnr's model): rejected, it breaks on column renames, can't express hand-written or AI messages and languages, and can't tell Learn which message or audience performed.
