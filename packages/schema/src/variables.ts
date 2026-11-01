// Variables a layer's properties follow (ADR-0007). For now the brand kit's tokens (#53): a brand's
// colours and fonts, named `brand:<token>`, which a layer binds its fill, its text colour or its
// font family to, so changing the brand colour changes every design that uses it.
import { z } from 'zod'
import { boundFillIndex } from './paint.ts'
import { Color } from './primitives.ts'

/** A brand kit token's name: lowercase words joined by hyphens, such as `primary` or `sale-red`. */
export const BrandToken = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'a token is lowercase words joined by hyphens').max(40)
export type BrandToken = z.infer<typeof BrandToken>

/** What a bound property follows: a brand kit token, `brand:<token>`. */
export const VariableRef = z.templateLiteral(['brand:', BrandToken])
export type VariableRef = z.infer<typeof VariableRef>
export const brandRef = (token: string): VariableRef => `brand:${token}` as VariableRef

/**
 * What a layer can bind (#53): the colour of its topmost solid fill (a graphic, frame or boolean),
 * or its text's base colour and font family. Runs that set their own colour or font keep it.
 */
export const BINDING_TARGETS = ['fill', 'textColor', 'fontFamily'] as const
export type BindingTarget = (typeof BINDING_TARGETS)[number]
export const Bindings = z.object({ fill: VariableRef.optional(), textColor: VariableRef.optional(), fontFamily: VariableRef.optional() })
export type Bindings = z.infer<typeof Bindings>

/** Whether a layer of this type has the property a target binds. */
export const canBind = (type: string, target: BindingTarget) =>
  target === 'fill' ? type === 'graphic' || type === 'frame' || type === 'boolean' : type === 'text'

/** The values variables have where a design is drawn: a colour (#RRGGBBAA) or a font family, by ref. */
export type Variables = Readonly<Record<string, string>>

/** Whether a value suits a target: a colour for a fill or text colour, a family name for a font. */
export const fitsTarget = (target: BindingTarget, value: string) =>
  target === 'fontFamily' ? value.trim().length > 0 : Color.safeParse(value).success

/**
 * A layer's props with its bound properties set from `variables`. A binding whose variable has no
 * value, or a value that doesn't suit it, leaves the property as the layer stores it: the value it
 * had when it was bound, or last set. Props come back as they were when nothing changes.
 */
export function bindProps<P extends Record<string, unknown>>(type: string, props: P, bindings: Bindings | undefined, variables: Variables | undefined): P {
  if (!bindings || !variables) return props
  let out = props
  for (const target of BINDING_TARGETS) {
    const ref = bindings[target]
    const value = ref === undefined ? undefined : variables[ref]
    if (value === undefined || !canBind(type, target) || !fitsTarget(target, value)) continue
    if (target === 'fill') {
      const fills = out.fills
      if (!Array.isArray(fills)) continue
      const at = boundFillIndex(fills)
      if (at < 0 || (fills[at] as { color?: unknown }).color === value) continue
      out = { ...out, fills: fills.map((f: unknown, i: number) => (i === at ? { ...(f as object), color: value } : f)) }
      continue
    }
    const style = out.style as Record<string, unknown> | undefined
    if (!style) continue
    const key = target === 'textColor' ? 'color' : 'fontFamily'
    if (style[key] === value) continue
    out = { ...out, style: { ...style, [key]: value } }
  }
  return out
}
