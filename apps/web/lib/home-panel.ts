// The panel open under a brand home's brief, kept in the address (?show=recent, ?show=templates) so
// it survives a reload and the back button, and can be linked to.
export const HOME_PANELS = ['recent', 'templates'] as const

export type HomePanel = (typeof HOME_PANELS)[number]

export const panelOf = (value: string | null | undefined): HomePanel | null =>
  HOME_PANELS.find((panel) => panel === value) ?? null

/** A brand home's address with a panel open, or with none. */
export const homePanelHref = (home: string, panel: HomePanel | null) => (panel ? `${home}?show=${panel}` : home)
