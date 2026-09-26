import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const NETWORK_MODULES = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'dns/promises'].flatMap((m) => [m, `node:${m}`]);

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strict],
  },
  {
    // C1 persistence boundary: node:sqlite (a Release Candidate API) stays inside the storage adapter.
    files: ['packages/**/*.ts'],
    ignores: ['packages/storage/src/sqlite/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'node:sqlite', message: 'Only packages/storage/src/sqlite/connection.ts may import node:sqlite.' }] }],
    },
  },
  {
    // C1 runtime code opens no network path (no listener, no provider call).
    files: ['packages/*/src/**/*.ts'],
    ignores: ['packages/storage/src/sqlite/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'node:sqlite', message: 'Only packages/storage/src/sqlite/connection.ts may import node:sqlite.' },
            ...NETWORK_MODULES.map((name) => ({ name, message: 'C1 runtime code has no network surface.' })),
            ...['child_process', 'node:child_process', 'worker_threads', 'node:worker_threads'].map((name) => ({ name, message: 'C1 runtime code executes no external tools or processes.' })),
          ],
        },
      ],
      'no-restricted-globals': ['error', { name: 'fetch', message: 'C1 runtime code makes no network calls.' }],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
);
