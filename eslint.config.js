// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Engine purity rules: packages/engine may not import react/dom/renderer code,
// touch DOM globals or the wall clock, or call Math.random (use the seeded RNG).
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.config.*"],
  },
  {
    // allow `_`-prefixed unused bindings, e.g. the `_never` exhaustiveness guards
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["packages/engine/**/*.ts"],
    languageOptions: {
      globals: {}, // no browser/node globals in the engine
    },
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "window", message: "Engine must be DOM-free." },
        { name: "document", message: "Engine must be DOM-free." },
        { name: "navigator", message: "Engine must be DOM-free." },
        { name: "localStorage", message: "Engine must be DOM-free." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date']",
          message: "Engine must be wall-clock-free. Use seeded values in state.",
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: "Engine must be wall-clock-free.",
        },
        {
          selector: "MemberExpression[object.name='performance']",
          message: "Engine must be wall-clock-free.",
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: "Engine must use the seeded RNG stored in GameState, not Math.random.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-dom", "react/*"], message: "Engine must be React-free." },
            { group: ["zustand", "zustand/*"], message: "Engine must be UI-state-free." },
            { group: ["pixi.js", "@pixi/*"], message: "Engine must be renderer-free." },
          ],
        },
      ],
    },
  },
);
