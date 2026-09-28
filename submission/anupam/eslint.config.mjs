import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'coverage', 'jest.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
