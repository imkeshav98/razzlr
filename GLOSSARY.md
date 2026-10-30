# Razzlr

The design editor and AI ad flow for agencies. This glossary covers the document model the editor, renderer and AI jobs share, and the agency records around it.

## Agency

**Org**:
An agency account: its seats, clients, AI credits and billing.
_Avoid_: Workspace, team, tenant

**Client**:
A brand the agency works for. Every design, brand kit and asset belongs to exactly one client.
_Avoid_: Customer, account, brand

**Brand kit**:
A client's logo, colours, fonts and tone of voice, applied automatically. Its colours and fonts are exposed to designs as variables.
_Avoid_: Brand guide, theme, style

**Reviewer**:
A guest who views, comments on and approves designs without a paid seat.
_Avoid_: Client user, approver

## Design document

**Design**:
One editable piece of work, stored as one Yjs document: a grid of pages × formats plus its layers, variables and overrides.
_Avoid_: Project, file, canvas, document (in UI copy)

**Design kind**:
What a design is for: single, carousel, story or document.

**Page**:
One card of a carousel, one frame of a story, or the only canvas of a single ad. Every page is delivered in every format of its design.
_Avoid_: Slide, artboard, card (in code)

**Master**:
A page whose layers appear on every page that uses it; a page can hide or change them through a page override.
_Avoid_: Template, layout

**Format**:
One delivered size of a design, such as 1080×1080 or 320×50. Formats share content and keep their own layout.
_Avoid_: Size, artboard, variant, ratio

**Primary format**:
The format whose layout seeds any format that has no stored value yet.

**Layer**:
One element in a page's tree, stored in the flat `nodes` map with a parent id and fractional index. There are seven layer types: frame, group, graphic, boolean, text, instance, lottie.
_Avoid_: Element, object, block, item

**Graphic**:
A layer made of a shape plus fills, strokes and effects. Photos and video are fills on a graphic, not layers of their own.
_Avoid_: Image layer, shape layer, rectangle layer

**Fill**:
One paint on a layer: solid, gradient, image or video. A crop is the fill's transform.
_Avoid_: Background, colour (when a paint is meant)

**Role**:
A layer's meaning in the ad (headline, price, logo, product, cta, …), used by AI, Ad check, adapt and feed binding.
_Avoid_: Kind, tag, semantic type

**Spanning layer**:
A carousel layer that sits on the strip of all cards, so each card shows its own slice.

**Property path**:
The typed string that names one property of a layer, such as `x`, `fills` or `text.boxMode`. Commands, overrides, bindings and the assistant all address properties this way.

## Variants and overrides

**Variable**:
A named, typed value a design declares (headline, hero, price, accent) that layers bind their properties to.
_Avoid_: Field, slot, column, placeholder

**Axis**:
One dimension variants are built along: product, message, audience or language.

**Variant**:
One combination of axis values, and so one set of variable values. Every variant has a stable id carried into publishing and Learn.
_Avoid_: Row, version, version (see Version), flavour

**Feed**:
An external source of axis values, such as a product catalog, synced on a schedule.
_Avoid_: Data source, CSV

**Rule**:
A typed condition over variables that sets a layer property, such as "show the badge when discount > 0". Never free code.

**Override**:
A sparse change to one property of one layer at a scope narrower than the base. Overrides never copy layers.

**Scope**:
Where an override applies. In resolution order, most specific first: format within a variant, variant, variable, page, format, base.

**Resolve**:
Picking a property's value for one layer, page, format and variant by walking the scopes in order.

## Editing

**Command**:
A named, zod-validated change to a design that runs in one Yjs transaction and is one undo step. The only way anything writes to a design.
_Avoid_: Action, mutation, operation

**Version**:
A snapshot of a design, either named on purpose or taken automatically before AI actions and every 30 minutes.
_Avoid_: Revision, checkpoint (for named versions)

## Rendering

**Scene**:
The renderer's output for one page, format and variant: a resolved tree ready to draw. `render(design, pageId, formatId, variant?, translations?, assets) → scene` is a pure function.

**Surface**:
Where a scene is drawn: the WebGL surface for the editor screen, or the CPU surface for every export.

**Export parity**:
CPU renders of the same design in the browser and in Node being pixel-identical (0 differing pixels).

## AI flow

**Brief**:
A few words, up to four pictures and a format that start a tree.

**Tree**:
Everything grown from one brief: its rounds and their drafts.

**Round**:
One planning call and the four drafts it produced.

**Draft**:
One flat AI-generated ad in a round. Starred, used, or refined into draft versions.
_Avoid_: Generation, option, candidate

**Layering**:
The job that turns a chosen draft into real layers: plan, separate, read, live text, vectorise, backdrop, place.
_Avoid_: Decompose, editable-ize, convert
