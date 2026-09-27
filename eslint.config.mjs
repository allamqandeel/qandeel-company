import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// C2: provider adapters (`generate`) are called only by the governed Model Runtime and tool drivers
// (`invoke`) only by the Tool Executor — in any syntactic form (dot, computed, destructuring).
const C2_CONFINED = [
  { selector: 'MemberExpression[property.name=/^(generate|invoke)$/]', message: 'Provider adapters / tool drivers are called only by the governed Model Runtime / Tool Executor (C2).' },
  { selector: 'MemberExpression[computed=true][property.value=/^(generate|invoke)$/]', message: 'Provider adapters / tool drivers are called only by the governed Model Runtime / Tool Executor (C2).' },
  { selector: 'ObjectPattern > Property[key.name=/^(generate|invoke)$/]', message: 'Provider adapters / tool drivers are called only by the governed Model Runtime / Tool Executor (C2).' },
];
const C2_CONFINED_MODULES = ['packages/runtime/src/c2/model-runtime.ts', 'packages/runtime/src/c2/tool-executor.ts'];

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
          // `testing` (the test-only Founder seam, D-C2-13) is policed by the verifier rules
          // `runtime-authority-confined` / `founder-surface-test-only`: tests and the C2 acceptance only.
          selector: ":matches(ImportDeclaration, ImportExpression, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^@qandeel-company\\/storage\\/(?!testing$)/]",
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
        ...C2_CONFINED,
      ],
    },
  },
  {
    // C2 confinement inside the storage package (its own import rules are the verifier's).
    files: ['packages/storage/src/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...C2_CONFINED] },
  },
  {
    // The runtime may import the runtime-authority subpath, but no other storage subpath, and its
    // production code never imports storage internals by path.
    files: ['packages/runtime/src/**/*.ts'],
    ignores: C2_CONFINED_MODULES,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...C2_CONFINED,
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
  },  {
    // The runtime may import the runtime-authority subpath, but no other storage subpath, and its
    // production code never imports storage internals by path.
    // The two confined modules: the same import rules, without the C2 confinement they implement.
    files: C2_CONFINED_MODULES,
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
