'use client'
// Scrolling areas draw their bars with OverlayScrollbars: a slim bar over the content that shows while
// the area scrolls or the pointer is over it, and widens under the pointer (the look is .os-theme-dazbee
// in globals.css). The area stays its own viewport, so its children, scroll events and scrollTop are
// those of a plain scrolling element.
import { OverlayScrollbars, type PartialOptions } from 'overlayscrollbars'
import { useCallback, useEffect, type RefObject } from 'react'

const OPTIONS: PartialOptions = {
  scrollbars: { theme: 'os-theme-dazbee', autoHide: 'leave', autoHideDelay: 800, clickScroll: true },
}

/** A ref callback that gives the element overlay bars, and takes them away when it unmounts. */
export function overlayScroll(element: HTMLElement | null) {
  if (!element) return
  const bars = OverlayScrollbars({ target: element, elements: { viewport: element } }, OPTIONS)
  return () => bars.destroy()
}

/** The same ref callback for an element that has a ref of its own, which it keeps filled. */
export function useOverlayScroll<T extends HTMLElement>(ref: RefObject<T | null>) {
  return useCallback(
    (element: T | null) => {
      ref.current = element
      const off = overlayScroll(element)
      return () => {
        off?.()
        ref.current = null
      }
    },
    [ref],
  )
}

/** Gives the page itself overlay bars, without moving the body's children. */
export function PageScroll() {
  useEffect(() => {
    const bars = OverlayScrollbars({ target: document.body, elements: { viewport: document.body } }, OPTIONS)
    return () => bars.destroy()
  }, [])
  return null
}
