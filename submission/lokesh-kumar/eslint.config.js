import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "dist", "coverage"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow an intentionally unused argument when it is prefixed with an underscore
      // (Express needs the 4-argument signature to recognise an error handler).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
