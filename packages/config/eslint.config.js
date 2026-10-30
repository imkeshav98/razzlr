// Shared ESLint preset: import it from a package's own eslint.config.js.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/next-env.d.ts', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  { files: ['**/*.js', '**/*.mjs'], languageOptions: { globals: globals.node } },
)
