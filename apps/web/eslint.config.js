import preset from '@razzlr/config/eslint'
import react from 'eslint-plugin-react'

export default [
  ...preset,
  {
    // Every string the UI shows comes from a message catalog (lib/i18n), so components hold none.
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    plugins: { react },
    rules: {
      'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true, allowedStrings: ['/', '·'] }],
    },
  },
]
