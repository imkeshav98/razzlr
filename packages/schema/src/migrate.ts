// Schema versions (#43). A design is saved with the version it was written at; reading one saved
// at an older version first runs every step from there up to this one. Steps work on plain JSON,
// before validation, and never change what they are given.

/** The version every design is written at. */
export const SCHEMA_VERSION = 3

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Version 2 gives groups and frames pass-through blending, and makes `normal` on them draw the
 * children together first. Version 1 drew a `normal` group or frame as pass-through does, so
 * those become pass-through, in format overrides too, and every design looks as it did.
 */
function toVersion2(design: Json): Json {
  const nodes = isRecord(design.nodes) ? design.nodes : {}
  const isContainer = (id: string) => {
    const node = Object.hasOwn(nodes, id) ? nodes[id] : undefined
    return isRecord(node) && (node.type === 'group' || node.type === 'frame')
  }
  const passThrough = (props: Json, always: boolean) =>
    props.blendMode === 'normal' || (always && props.blendMode === undefined) ? { ...props, blendMode: 'pass-through' } : props
  const migratedNodes = Object.fromEntries(Object.entries(nodes).map(([id, node]) => [
    id,
    isContainer(id) && isRecord(node) && isRecord(node.props) ? { ...node, props: passThrough(node.props, true) } : node,
  ]))
  const overrides = isRecord(design.overrides)
    ? Object.fromEntries(Object.entries(design.overrides).map(([scope, byNode]) => [
      scope,
      isRecord(byNode)
        ? Object.fromEntries(Object.entries(byNode).map(([id, values]) => [id, isContainer(id) && isRecord(values) ? passThrough(values, false) : values]))
        : byNode,
    ]))
    : design.overrides
  return { ...design, nodes: migratedNodes, ...(design.overrides === undefined ? {} : { overrides }) }
}

/**
 * Version 3 lets every paint have an opacity of its own and be hidden (#219). Version 2 paints
 * have neither, and without them a paint is opaque and shows, so a version 2 design comes up as
 * it is.
 */
const toVersion3 = (design: Json): Json => design

/** Each step takes a design from the version it is listed under to the next one. */
const STEPS: Record<number, (design: Json) => Json> = { 1: toVersion2, 2: toVersion3 }

/** The version a design says it was saved at, if it says one. */
export const versionOf = (input: unknown) => {
  const version = isRecord(input) && isRecord(input.meta) ? input.meta.schemaVersion : undefined
  return typeof version === 'number' ? version : undefined
}

/**
 * Brings a design saved at an older version up to SCHEMA_VERSION. Anything else, a design at
 * this version, a newer or unknown one, or something that isn't a design, comes back unchanged
 * for validation to judge.
 */
export function migrateDesign(input: unknown): unknown {
  let version = versionOf(input)
  if (version === undefined || version >= SCHEMA_VERSION || !STEPS[version] || !isRecord(input)) return input
  let design: Json = input
  for (; version < SCHEMA_VERSION; version++) {
    const step = STEPS[version]
    if (!step) return input
    design = step(design)
  }
  return { ...design, meta: { ...(design.meta as Json), schemaVersion: SCHEMA_VERSION } }
}
