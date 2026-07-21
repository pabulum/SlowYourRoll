import js from "@eslint/js";
import globals from "globals";

export default [
  // The generated database is huge and not hand-maintained; don't lint it.
  { ignores: ["data/qe-data.js", "node_modules/**"] },

  js.configs.recommended,

  // Browser app source.
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
    },
  },

  // Tests, build scripts, and config files run under Node.
  {
    files: ["tests/**/*.js", "scripts/**/*.mjs", "*.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
  },
];
