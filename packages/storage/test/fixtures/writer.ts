/**
 * Child-process fixture: continuously creates executable Work Items (each with its queue job, in
 * one transaction) until killed, printing a heartbeat line every 25 writes.
 * argv: <workspaceRoot>
 */
import { CompanyStore } from '../../src/index.js';

const store = CompanyStore.open(String(process.argv[2]), { busyTimeoutMs: 10_000 });
let n = 0;
process.stdout.write('WRITING\n');
for (;;) {
  store.createWorkItem({ objective: `concurrent ${n}`, ownerRef: 'owner:founder', initialState: 'READY', processorKind: 'test.noop' });
  n++;
  if (n % 25 === 0) process.stdout.write(`WROTE ${n}\n`);
  await new Promise((resolve) => setImmediate(resolve));
}
