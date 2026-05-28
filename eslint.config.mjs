// eslint.config.mjs

import js from "@eslint/js";
import tseslint from "typescript-eslint";

import nextPlugin from "@next/eslint-plugin-next";

import importPlugin from "eslint-plugin-import";
import unusedImports from "eslint-plugin-unused-imports";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

import globals from "globals";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  /**
   * ==========================================
   * GLOBAL IGNORES
   * ==========================================
   */
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "node_modules/**",

      "*.config.js",
      "*.config.mjs",

      "**/*.generated.*",
      "**/generated/**",
    ],
  },

  /**
   * ==========================================
   * BASE JS
   * ==========================================
   */
  js.configs.recommended,

  /**
   * ==========================================
   * TYPESCRIPT
   * ==========================================
   */
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  /**
   * ==========================================
   * NEXT.JS
   * ==========================================
   */
  {
    plugins: {
      "@next/next": nextPlugin,
    },

    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },

  /**
   * ==========================================
   * APP CONFIG
   * ==========================================
   */
  {
    files: ["**/*.{ts,tsx,js,jsx,mts,cts}"],

    languageOptions: {
      parser: tseslint.parser,

      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },

      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },

    plugins: {
      "@typescript-eslint": tseslint.plugin,

      import: importPlugin,

      "unused-imports": unusedImports,

      "react-hooks": reactHooks,

      "jsx-a11y": jsxA11y,
    },

    settings: {
      react: {
        version: "detect",
      },

      "import/resolver": {
        typescript: true,
      },
    },

    rules: {
      /**
       * ======================================
       * UNUSED IMPORTS
       * ======================================
       */

      "@typescript-eslint/no-unused-vars": "off",

      "unused-imports/no-unused-imports": "error",

      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",

          args: "after-used",
          argsIgnorePattern: "^_",

          ignoreRestSiblings: true,
        },
      ],

      /**
       * ======================================
       * TYPESCRIPT
       * ======================================
       */

      "@typescript-eslint/no-explicit-any": "warn",

      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],

      "@typescript-eslint/no-floating-promises": "error",

      "@typescript-eslint/await-thenable": "error",

      "@typescript-eslint/prefer-nullish-coalescing": "error",

      "@typescript-eslint/prefer-optional-chain": "error",

      "@typescript-eslint/consistent-type-definitions": [
        "error",
        "interface",
      ],

      /**
       * ======================================
       * REACT
       * ======================================
       */

      "react-hooks/rules-of-hooks": "error",

      "react-hooks/exhaustive-deps": "warn",

      /**
       * ======================================
       * IMPORTS
       * ======================================
       */

      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
            "type",
          ],

          pathGroups: [
            {
              pattern: "@/**",
              group: "internal",
            },
          ],

          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },

          "newlines-between": "always",
        },
      ],

      "import/no-duplicates": "error",

      "import/newline-after-import": [
        "error",
        {
          count: 1,
        },
      ],

      /**
       * ======================================
       * ACCESSIBILITY
       * ======================================
       */

      "jsx-a11y/alt-text": "warn",

      "jsx-a11y/anchor-is-valid": "error",

      /**
       * ======================================
       * GENERAL
       * ======================================
       */

      eqeqeq: ["error", "always"],

      curly: ["error", "all"],

      "no-console":
        process.env.NODE_ENV === "production"
          ? ["warn", { allow: ["warn", "error"] }]
          : "off",

      "no-debugger":
        process.env.NODE_ENV === "production"
          ? "error"
          : "warn",

      "prefer-const": "error",

      "object-shorthand": ["error", "always"],

      "prefer-template": "error",

      "arrow-body-style": ["error", "as-needed"],

      /**
       * ======================================
       * NEXT.JS 16
       * ======================================
       */

      "@next/next/no-img-element": "warn",

      "@next/next/no-html-link-for-pages": "off",
    },
  },

  /**
   * ==========================================
   * PRETTIER
   * ==========================================
   */
  prettier
);