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
    // D-C1-22: runtime authority (claims, supervisor lease, worker writes) is importable by the
    // runtime package only, and no package reaches into another package's internals by path.
    files: ['packages/**/*.ts', 'scripts/**/*.mjs'],
    // The verifier itself imports the subpath and probes a deep import to prove it is refused.
    ignores: ['packages/runtime/**', 'packages/storage/**', 'scripts/verify-bootstrap.mjs'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: ":matches(ImportDeclaration, ImportExpression, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^@qandeel-company\\/storage\\//]",
          message: 'Only @qandeel-company/runtime may import @qandeel-company/storage/runtime-authority (D-C1-22); use the ordinary @qandeel-company/storage API.',
        },
        {
          selector: ':matches(ImportDeclaration, ImportExpression, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/\\/storage\\/(src|dist)\\//]',
          message: 'Do not import storage internals by path (D-C1-22).',
        },
        {
          selector: "CallExpression[callee.name='createRequire'], MemberExpression[property.name='createRequire']",
          message: 'createRequire can bypass the import boundary checks; use static ESM imports (D-C1-22).',
        },
      ],
    },
  },
  {
    // The runtime may import the runtime-authority subpath, but no other storage subpath, and its
    // production code never imports storage internals by path.
    files: ['packages/runtime/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: ":matches(ImportDeclaration, ImportExpression, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^@qandeel-company\\/storage\\/(?!runtime-authority$)/]",
          message: 'The only storage subpath the runtime may import is @qandeel-company/storage/runtime-authority.',
        },
        {
          selector: ':matches(ImportDeclaration, ImportExpression, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/\\/storage\\/(src|dist)\\//]',
          message: 'Do not import storage internals by path (D-C1-22).',
        },
        {
          selector: "CallExpression[callee.name='createRequire'], MemberExpression[property.name='createRequire']",
          message: 'createRequire can bypass the import boundary checks; use static ESM imports (D-C1-22).',
        },
      ],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
);
