'use client'

// The brand's kit as the editor shows it, shared by the Brand flyout and the Page card: a change
// made in the flyout shows in the Page card's colours at once. Fetched once per brand, and again
// each time the flyout opens.
import { BrandKit, EMPTY_BRAND_KIT } from '@razzlr/schema'
import { useCallback, useEffect, useSyncExternalStore } from 'react'

export const kitUrl = (brandId: string) => `/brands/${encodeURIComponent(brandId)}/kit`

const kits = new Map<string, BrandKit>()
const listeners = new Map<string, Set<() => void>>()

/** Shows a kit everywhere it is drawn, before it is saved. */
export function showKit(brandId: string, kit: BrandKit) {
  kits.set(brandId, kit)
  for (const listener of listeners.get(brandId) ?? []) listener()
}

/** Fetches the kit; offline, or when the brand has none yet, it is the empty kit. */
export async function loadKit(brandId: string) {
  const response = await fetch(kitUrl(brandId)).catch(() => null)
  if (response?.ok) showKit(brandId, BrandKit.parse(await response.json()))
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
