// Shared ESLint preset: import it from a package's own eslint.config.js.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/next-env.d.ts', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  { files: ['**/*.js', '**/*.mjs'], languageOptions: { globals: globals.node } },
  {
    // ADR-0001: reach other workspaces through their declared package name, never a relative path,
    // so the dependency-direction check sees every edge.
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '^(\\.\\./)+(apps|packages|tests)/',
          message: 'Import another workspace by its package name and declare it in package.json.',
        }],
      }],
    },
  },
)
