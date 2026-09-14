import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', '.test-build/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  {
    files: ['**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: ['tests/types/*'],
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },
  {
    files: ['tests/types/*.cts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
