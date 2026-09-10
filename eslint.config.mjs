import tsParser from '@typescript-eslint/parser'
import reactStyle from 'ti-reactu/eslint-plugin-react-style'

export default [
  { ignores: ['node_modules/**', 'out/**', 'release/**', 'dist/**', 'website/dist/**', '.worktrees/**', 'artifacts/**', 'test-results/**'] },
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'website/src/**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } },
    plugins: { 'react-style': reactStyle },
    rules: { ...reactStyle.configs.recommended.rules },
  },
  { files: ['**/*.ts', '**/*.tsx'], languageOptions: { parser: tsParser } },
]
