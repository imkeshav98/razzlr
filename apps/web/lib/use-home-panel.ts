'use client'

// Opening and closing a brand home's panel in the address, and reading which is open, for the
// capsule and the home (see home-panel.ts).
import { useSyncExternalStore } from 'react'
import { homePanelHref, panelOf, type HomePanel } from './home-panel.ts'

const CHANGED = 'razzlr:home-panel'

/** Opens a panel, or closes it with null, as a new history entry on the same page. */
export function showHomePanel(home: string, panel: HomePanel | null) {
  window.history.pushState(null, '', homePanelHref(home, panel))
  window.dispatchEvent(new Event(CHANGED))
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange)
  window.addEventListener(CHANGED, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(CHANGED, onChange)
  }
}

/**
 * The open panel, read from the address itself: a router render that lands late (after the back
 * button) never brings back a panel that was closed since. The server's search params give the
 * first render.
 */
export const useHomePanel = (fromServer: HomePanel | null) =>
  useSyncExternalStore(subscribe, () => panelOf(new URLSearchParams(window.location.search).get('show')), () => fromServer)
