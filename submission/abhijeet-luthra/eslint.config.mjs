// Flat ESLint config: recommended JS + TypeScript rules, nothing exotic.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.js', '*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
