import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // next dev writes no AGENTS.md: the repo's own CLAUDE.md is the agents' guide.
  agentRules: false,
  turbopack: {
    resolveAlias: {
      fs: { browser: './lib/empty.ts' },
      path: { browser: './lib/empty.ts' },
    },
  },
}

export default config
