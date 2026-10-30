import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      fs: { browser: './lib/empty.ts' },
      path: { browser: './lib/empty.ts' },
    },
  },
}

export default config
