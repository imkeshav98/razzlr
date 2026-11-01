'use client'

// The brand's kit as the editor shows it, shared by the Brand flyout and the Page card: a change
// made in the flyout shows in the Page card's colours at once. Fetched once per brand, and again
// each time the flyout opens; a fetch waits for a save still on its way, so it never brings back
// the kit from before that save.
import { BrandKit, EMPTY_BRAND_KIT } from '@dazbee/schema'
import { useCallback, useEffect, useSyncExternalStore } from 'react'

export const kitUrl = (brandId: string) => `/brands/${encodeURIComponent(brandId)}/kit`

const kits = new Map<string, BrandKit>()
const listeners = new Map<string, Set<() => void>>()
const saving = new Map<string, Promise<unknown>>()

/** Shows a kit everywhere it is drawn, before it is saved. */
export function showKit(brandId: string, kit: BrandKit) {
  kits.set(brandId, kit)
  for (const listener of listeners.get(brandId) ?? []) listener()
}

/** Saves the kit; a fetch started meanwhile waits for it. Resolves to the response, or rejects as fetch does. */
export function saveKit(brandId: string, kit: BrandKit) {
  const put = fetch(kitUrl(brandId), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(kit) })
  const settled = put.catch(() => undefined)
  saving.set(brandId, settled)
  void settled.then(() => {
    if (saving.get(brandId) === settled) saving.delete(brandId)
  })
  return put
}

/** Fetches the kit; offline, when the brand has none yet, or when it can't be read, it stays as it is or is the empty kit. */
export async function loadKit(brandId: string) {
  await saving.get(brandId)
  const response = await fetch(kitUrl(brandId)).catch(() => null)
  const kit = response?.ok ? BrandKit.safeParse(await response.json().catch(() => null)) : null
  if (kit?.success) showKit(brandId, kit.data)
  else if (!kits.has(brandId)) showKit(brandId, EMPTY_BRAND_KIT)
}

/** The brand's kit, or null until it first arrives. */
export function useBrandKit(brandId: string) {
  const subscribe = useCallback((listener: () => void) => {
    const set = listeners.get(brandId) ?? new Set()
    listeners.set(brandId, set.add(listener))
    return () => {
      set.delete(listener)
    }
  }, [brandId])
  const kit = useSyncExternalStore(subscribe, () => kits.get(brandId) ?? null, () => null)
  useEffect(() => {
    if (!kits.has(brandId)) void loadKit(brandId)
  }, [brandId])
  return kit
}
