import preset from '@dazbee/config/eslint'
import react from 'eslint-plugin-react'
import globals from 'globals'

export default [
  ...preset,
  {
    // The offline worker (#37) runs in a service worker, not a page.
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    // Every string the UI shows comes from a message catalog (lib/i18n), so components hold none.
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    plugins: { react },
    rules: {
      'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true, allowedStrings: ['/', '·'] }],
      // Chrome flags form fields with neither an id nor a name, and autofill can't tell them apart.
      'no-restricted-syntax': ['error', {
        selector: 'JSXOpeningElement[name.name=/^(input|select|textarea)$/]:not(:has(JSXAttribute[name.name=/^(id|name)$/])):not(:has(JSXSpreadAttribute))',
        message: 'Give every input, select and textarea a name (or an id).',
      }],
    },
  },
]
