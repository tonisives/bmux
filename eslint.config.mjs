import tsParser from '@typescript-eslint/parser'
import reactStyle from 'ti-reactu/eslint-plugin-react-style'

export default [
  { ignores: ['node_modules/**', 'out/**', 'build/*.app/**', 'release/**', 'dist/**', '.worktrees/**', 'artifacts/**', 'test-results/**', 'remote-app/ios/**', 'remote-app/android/**', 'remote-app/dist/**', 'remote-app/.expo/**'] },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } },
    plugins: { 'react-style': reactStyle },
    rules: { ...reactStyle.configs.recommended.rules },
  },
  { files: ['**/*.ts', '**/*.tsx'], languageOptions: { parser: tsParser } },
]
