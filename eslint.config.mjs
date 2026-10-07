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
    // C1 runtime code opens no network path (no listener, no provider call). C5's one exception is the
    // loopback Founder listener (`packages/command-center/src/server/listener.ts`, verifier rule
    // `founder-listener-loopback-only`) and the browser UI, which talks to that listener with fetch.
    files: ['packages/*/src/**/*.ts'],
    // C7-D adds two reviewed network paths: the isolated loopback Preview host and the one fixed-host GitHub transport
    // (verifier rules `c7d-preview-isolated` / `c7d-tool-boundary`). L1-01 adds the one fixed-host DeepSeek transport
    // (`l1-provider-boundary`) and the one reviewed process path: the Windows DPAPI vault through the signed PowerShell
    // host (`l1-vault-protected`). OPS adds the Founder host lifecycle's two (`founder-host-confined`): the loopback-only
    // host probe, the one-shot loopback launch handoff (D-OPS-07) and the one module that starts the host, the browser and the
    // signed PowerShell host.
    ignores: ['packages/storage/src/sqlite/**', 'packages/command-center/src/server/listener.ts', 'packages/command-center/src/server/preview-listener.ts', 'packages/tool-drivers/src/github/https-transport.ts', 'packages/model-providers/src/deepseek/https-transport.ts', 'packages/secret-vault/src/windows-dpapi.ts', 'packages/command-center/src/host/probe.ts', 'packages/command-center/src/host/handoff.ts', 'packages/command-center/src/host/processes.ts', 'packages/command-center-ui/src/**'],
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
    // C7-D driver unit tests exercise an adapter directly (its contract, its fail-closed gates); production code still
    // reaches a driver only through the Tool Executor (verifier `tool-drivers-confined` scans every src module).
    files: ['packages/tool-drivers/test/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: ":matches(ImportDeclaration, ImportExpression, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^@qandeel-company\\/storage/]", message: 'Driver tests never reach the Company store; they use a fake promotion source.' },
      ],
    },
  },
  {
    // L1-01 adapter unit tests exercise `generate` directly (the contract, the boundary, the failure mapping); production
    // code still reaches an adapter only through the governed Model Runtime (verifier `model-calls-confined` scans src).
    files: ['packages/model-providers/test/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: ":matches(ImportDeclaration, ImportExpression, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^@qandeel-company\\/(?:storage|runtime)/]", message: 'Adapter tests never reach the Company store or runtime; they use the fake transport and an in-memory vault.' },
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
    // The Founder listener: the one module that may open a (loopback-only) network path; still no SQLite,
    // no child processes, no storage internals.
    files: ['packages/command-center/src/server/listener.ts', 'packages/command-center/src/server/preview-listener.ts', 'packages/tool-drivers/src/github/https-transport.ts', 'packages/model-providers/src/deepseek/https-transport.ts', 'packages/command-center/src/host/probe.ts', 'packages/command-center/src/host/handoff.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'node:sqlite', message: 'Only packages/storage/src/sqlite/connection.ts may import node:sqlite.' },
            ...['child_process', 'node:child_process', 'worker_threads', 'node:worker_threads'].map((name) => ({ name, message: 'The Founder surface executes no external tools or processes.' })),
          ],
        },
      ],
    },
  },
  {
    // L1-01 (D-L1-02): the Windows vault is the ONE module that may start a process — the signed Windows PowerShell host
    // for DPAPI — and it still opens no network path and reaches no SQLite.
    // OPS (D-OPS-04): the Founder host's process module starts the host, the browser and the signed PowerShell host — and
    // likewise opens no network path and reaches no SQLite.
    files: ['packages/secret-vault/src/windows-dpapi.ts', 'packages/command-center/src/host/processes.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'node:sqlite', message: 'Only packages/storage/src/sqlite/connection.ts may import node:sqlite.' },
            ...NETWORK_MODULES.map((name) => ({ name, message: 'The vault opens no network path.' })),
            { name: 'worker_threads', message: 'The vault starts only the signed PowerShell host.' },
            { name: 'node:worker_threads', message: 'The vault starts only the signed PowerShell host.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', { name: 'fetch', message: 'The vault makes no network calls.' }],
    },
  },
  {
    // The browser UI (C5): DOM globals, fetch to its own origin only (CSP connect-src 'self'), no Node modules.
    files: ['packages/command-center-ui/src/**/*.ts'],
    languageOptions: {
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly', fetch: 'readonly', EventSource: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', performance: 'readonly', localStorage: 'readonly', Intl: 'readonly', HTMLElement: 'readonly', HTMLButtonElement: 'readonly', HTMLInputElement: 'readonly', HTMLSelectElement: 'readonly', HTMLTextAreaElement: 'readonly', SVGElement: 'readonly', SVGSVGElement: 'readonly', SVGGElement: 'readonly', SVGPathElement: 'readonly', KeyboardEvent: 'readonly', PointerEvent: 'readonly', MouseEvent: 'readonly', RequestInit: 'readonly', Node: 'readonly', Buffer: 'readonly', console: 'readonly',
      },
    },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['node:*', '@qandeel-company/runtime', '@qandeel-company/storage/*'], message: 'The browser UI has no Node surface and reaches the Company only through the loopback API.' }] }],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      // Node 24 globals the scripts use (the C5 acceptance / visual proof drive a loopback surface and a
      // DevTools WebSocket through the runtime's built-ins; no dependency).
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly', Buffer: 'readonly', fetch: 'readonly', WebSocket: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', performance: 'readonly' },
    },
  },
);
