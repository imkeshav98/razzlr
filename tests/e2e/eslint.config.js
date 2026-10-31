import preset from '@razzlr/config/eslint'

export default [
  ...preset,
  {
    // Specs take `test` from support/test.ts, which fails a test on page errors, console errors and failed requests.
    files: ['specs/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@playwright/test', message: "Import test and expect from '../support/test.ts'." }],
        patterns: [{
          regex: '^(\\.\\./)+(apps|packages|tests)/',
          message: 'Import another workspace by its package name and declare it in package.json.',
        }],
      }],
    },
  },
]
