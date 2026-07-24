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

  // Build scripts and config files run under Node.
  {
    files: ["scripts/**/*.mjs", "*.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
  },

  // Tests run under Node, but against a real DOM (tests/page.js parses index.html with linkedom),
  // so they legitimately reach for both sets of globals.
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
