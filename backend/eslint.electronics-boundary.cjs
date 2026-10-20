// Import boundary for the electronics-costing domain layer: pure engines, routing and
// contracts. domain/ must not reach the database, HTTP, the queue, Nest, logging or the
// environment, and must not import api/, application/ or infrastructure/ of its own module.
// CommonJS so jest can load it; the root eslint config imports the same object.
'use strict';

const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

const PURE_MESSAGE = 'electronics domain/ is pure: no database, HTTP, filesystem, queue or framework imports.';

const PACKAGE_NAMES = [
  'pg', 'pg-boss', 'multer', 'rxjs', 'axios',
  'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
  'http', 'node:http', 'https', 'node:https', 'net', 'node:net',
  'child_process', 'node:child_process',
];

const electronicsDomainBoundary = {
  files: ['**/electronics-costing/domain/**/*.ts'],
  languageOptions: { parser: tsParser },
  plugins: { '@typescript-eslint': tsPlugin },
  rules: {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        paths: PACKAGE_NAMES.map((name) => ({ name, message: PURE_MESSAGE })),
        patterns: [
          { group: ['@nestjs/*', '@supabase/*'], message: PURE_MESSAGE },
          {
            group: ['**/infrastructure/**', '**/api/**', '**/application/**'],
            message: 'domain/ cannot import the api, application or infrastructure layers.',
          },
          {
            group: ['**/common/**'],
            message: 'domain/ cannot import shared Nest infrastructure (Supabase, logger, guards, ...).',
          },
          {
            // Kernel and DTO types are the sanctioned bridge to the cost kernel: types only.
            group: ['**/bom-items/**'],
            allowTypeImports: true,
            message: 'domain/ may import cost-kernel types (import type) but no runtime code from bom-items.',
          },
        ],
      },
    ],
    'no-restricted-globals': [
      'error',
      { name: 'console', message: 'domain/ does not log; return data and let the caller log.' },
      { name: 'fetch', message: 'domain/ does no I/O.' },
      { name: 'process', message: 'domain/ does not read the environment; take values as arguments.' },
    ],
  },
};

module.exports = { electronicsDomainBoundary };
