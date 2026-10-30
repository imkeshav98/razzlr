/**
 * "Spelled as intended": the comparison every measure uses. Spacing, line breaks and Latin case
 * are styling and don't count; every letter, mark, digit and symbol does, so ₹1,299 is not ₹1299
 * and a missing matra or dot fails.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '') // zero-width joiners: a reader can't see them
    .replace(/[\u2018\u2019\u201B\u2032]/gu, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/gu, '"')
    .replace(/[\u2010-\u2015\u2212]/gu, '-')
    .replace(/\u0640/gu, '') // Arabic tatweel only stretches a word
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en')
}

const meaningful = /[\p{L}\p{N}]/u

export interface Match {
  /** Per intended text: found spelled right in one of the seen texts. */
  found: boolean[]
  /** Pieces of seen text no intended text accounts for: stray, garbled or invented copy. */
  stray: string[]
}

/**
 * Finds each intended text inside the texts read off a draft. A reader may group two intended
 * texts into one block, so each is looked for as a whole-word run inside any block; what is left
 * of a block afterwards, if it has a letter or digit, is stray text.
 */
export function matchTexts(intended: string[], seen: string[]): Match {
  const blocks = seen.map(normalize)
  const found = intended.map((t) => {
    const want = normalize(t)
    for (const [i, block] of blocks.entries()) {
      const at = findWhole(block, want)
      if (at < 0) continue
      blocks[i] = `${block.slice(0, at)} ${block.slice(at + want.length)}`
      return true
    }
    return false
  })
  const stray = blocks.map((b) => b.trim()).filter((b) => meaningful.test(b))
  return { found, stray }
}

/** The first place `want` sits in `block` with no letter or digit glued to either side. */
function findWhole(block: string, want: string): number {
  for (let at = block.indexOf(want); at >= 0; at = block.indexOf(want, at + 1)) {
    const before = block.slice(0, at).at(-1) ?? ' '
    const after = block[at + want.length] ?? ' '
    if (!meaningful.test(before) && !/\p{M}/u.test(after) && !meaningful.test(after)) return at
  }
  return -1
}
