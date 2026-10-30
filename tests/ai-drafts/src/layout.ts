import type { DesignInput } from '@razzlr/schema'
import { z } from 'zod'
import { TextRole } from './ad.ts'

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colours are #RRGGBB')
export const Box = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() })
export type Box = z.infer<typeof Box>

/**
 * A draft's layers as the planner (hybrid) or the read step (flat) writes them, in format pixels,
 * back to front. `compose` turns it into a design our schema validates and our renderer draws.
 */
export const LayoutLayer = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    role: TextRole,
    /** Which of the ad's intended texts this is, by index; null for text the ad didn't ask for. */
    textIndex: z.number().int().min(0).nullable(),
    text: z.string().min(1),
    box: Box,
    family: z.string(),
    weight: z.number().int(),
    size: z.number().positive(),
    color: Hex,
    align: z.enum(['start', 'center', 'end']),
    lineHeight: z.number().positive().nullable(),
    letterSpacing: z.number().nullable(),
    shadow: z.boolean(),
  }),
  z.object({ type: z.literal('rect'), name: z.string(), box: Box, color: Hex, radius: z.number().min(0), opacity: z.number().min(0).max(1) }),
  /** A fade from transparent to a colour, behind text over a busy picture. */
  z.object({ type: z.literal('scrim'), box: Box, color: Hex, from: z.enum(['top', 'bottom', 'left', 'right']), opacity: z.number().min(0).max(1) }),
  z.object({ type: z.literal('image'), name: z.string(), asset: z.enum(['logo', 'product']), box: Box }),
  /** A piece of the flat draft kept as a picture, cut at its own place: lettering no font matches. */
  z.object({ type: z.literal('cutout'), name: z.string(), box: Box }),
])
export type LayoutLayer = z.infer<typeof LayoutLayer>

export const Layout = z.object({ layers: LayoutLayer.array() })
export type Layout = z.infer<typeof Layout>

const opaque = (hex: string) => `${hex.toUpperCase()}FF`
const withAlpha = (hex: string, a: number) => `${hex.toUpperCase()}${Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase()}`

/** Fractional indexes for n siblings in order: a0, a1, … a9, aA, … (base 62). */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const indexAt = (i: number) => `a${DIGITS[Math.floor(i / 62)] ?? 'z'}${DIGITS[i % 62]}`

const SCRIM_ENDS = {
  top: { from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 } },
  bottom: { from: { x: 0.5, y: 1 }, to: { x: 0.5, y: 0 } },
  left: { from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } },
  right: { from: { x: 1, y: 0.5 }, to: { x: 0, y: 0.5 } },
}

/** The schema's layer roles are fewer than the ad's text roles. */
const SCHEMA_ROLE = {
  brand: 'logo', headline: 'headline', subhead: 'subhead', body: 'body', price: 'price', offer: 'badge',
  code: 'badge', cta: 'cta', badge: 'badge', legal: 'body',
} as const

export interface ComposeInput {
  id: string
  width: number
  height: number
  /** The picture behind everything, by asset id: the hybrid's painting, or the flat draft or its backdrop. */
  picture?: string
  background?: string
  layout: Layout
}

/** One page, one format: the picture as an image fill, then every layout layer, as design JSON. */
export function compose({ id, width, height, picture, background = '#FFFFFF', layout }: ComposeInput): DesignInput {
  const nodes: DesignInput['nodes'] = {}
  let i = 0
  const add = (key: string, node: Omit<DesignInput['nodes'][string], 'parentId' | 'index'>) => {
    nodes[key] = { ...node, parentId: 'p1', index: indexAt(i++) } as DesignInput['nodes'][string]
  }
  if (picture) {
    add('picture', {
      type: 'graphic', name: 'Picture', role: 'background',
      props: { x: 0, y: 0, width, height, shape: { kind: 'rect' }, fills: [{ type: 'image', assetId: picture, fit: 'fill' }] },
    })
  }
  for (const [n, layer] of layout.layers.entries()) {
    const key = `${layer.type}${n}`
    const { x, y, w: lw, h: lh } = layer.box
    const box = { x, y, width: lw, height: lh }
    if (layer.type === 'rect') {
      add(key, { type: 'graphic', name: layer.name, props: { ...box, opacity: layer.opacity, shape: { kind: 'rect', cornerRadius: layer.radius }, fills: [{ type: 'solid', color: opaque(layer.color) }] } })
    } else if (layer.type === 'scrim') {
      add(key, {
        type: 'graphic', name: 'Scrim',
        props: { ...box, shape: { kind: 'rect' }, fills: [{ type: 'linear', ...SCRIM_ENDS[layer.from], stops: [{ offset: 0, color: withAlpha(layer.color, layer.opacity) }, { offset: 1, color: withAlpha(layer.color, 0) }] }] },
      })
    } else if (layer.type === 'cutout') {
      const cx = Math.max(0, x); const cy = Math.max(0, y)
      const crop = { x: cx, y: cy, width: Math.min(width, x + lw) - cx, height: Math.min(height, y + lh) - cy }
      if (crop.width > 0 && crop.height > 0) {
        add(key, { type: 'graphic', name: layer.name, props: { ...crop, shape: { kind: 'rect' }, fills: [{ type: 'image', assetId: 'draft', fit: 'crop', crop }] } })
      }
    } else if (layer.type === 'image') {
      add(key, { type: 'graphic', name: layer.name, role: layer.asset, props: { ...box, shape: { kind: 'rect' }, fills: [{ type: 'image', assetId: layer.asset, fit: 'fit' }] } })
    } else {
      add(key, {
        type: 'text', name: layer.role, role: SCHEMA_ROLE[layer.role],
        props: {
          ...box, text: layer.text, align: layer.align, verticalAlign: 'middle', boxMode: 'fixed',
          style: {
            fontFamily: layer.family, fontWeight: layer.weight, fontSize: layer.size, color: opaque(layer.color),
            ...(layer.lineHeight === null ? {} : { lineHeight: layer.lineHeight }),
            ...(layer.letterSpacing === null ? {} : { letterSpacing: layer.letterSpacing }),
          },
          effects: layer.shadow ? [{ type: 'dropShadow', x: 0, y: Math.max(1, layer.size / 24), blur: layer.size / 8, color: '#00000073' }] : [],
        },
      })
    }
  }
  return {
    meta: { schemaVersion: 1, designId: id, name: id, kind: 'single', primaryFormatId: 'f' },
    formats: { f: { name: `${width}×${height}`, width, height, order: 'a0' } },
    pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: opaque(background) }] } },
    nodes,
    overrides: {},
  }
}
