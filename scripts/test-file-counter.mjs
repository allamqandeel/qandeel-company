// A node:test reporter used by run-node-tests.mjs: it counts the passing leaf tests of each test file
// and emits one JSON document at the end, so the runner can refuse a file that ran no test at all (a
// proof file emptied down to its marker comment must fail, R1-15).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const normalize = (f) => {
  const p = f.startsWith('file:') ? fileURLToPath(f) : f;
  return path.resolve(p);
};

export default async function* fileCounter(source) {
  const perFile = {};
  for await (const event of source) {
    if (event.type !== 'test:pass') continue;
    const { file, name, nesting, details, skip, todo } = event.data;
    if (typeof file !== 'string' || details?.type === 'suite' || skip || todo) continue;
    const key = normalize(file);
    // A file that declares no test at all is reported as one synthetic passing "test" named after the
    // file itself: that proves nothing and is not counted.
    if (nesting === 0 && typeof name === 'string' && normalize(name).toLowerCase() === key.toLowerCase()) continue;
    perFile[key] = (perFile[key] ?? 0) + 1;
  }
  yield `${JSON.stringify(perFile)}\n`;
}
