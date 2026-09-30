/**
 * Child-process fixture (FB-2): runs a live portable restore and dies with a REAL process exit at the named lifecycle
 * point — no catch / finally runs, as with a kill or a power loss (open handles, an open write transaction and an
 * uncommitted WAL are left exactly as they are). Exit code 77 = died at the point; 0 = completed (the point never came).
 * argv: <packageFile> <targetRoot> <crashPoint>; the recovery passphrase arrives in QC_TEST_RECOVERY_PASSPHRASE.
 */
import { readFileSync } from 'node:fs';

import { restorePortableBackupInternal } from '../../src/resilience.js';

const [packageFile, target, point] = process.argv.slice(2);
restorePortableBackupInternal(readFileSync(String(packageFile)), String(target), { passphrase: process.env.QC_TEST_RECOVERY_PASSPHRASE ?? '' }, {
  fault: (p) => {
    if (p === point) process.exit(77);
  },
});
process.stdout.write(`${JSON.stringify({ completed: true })}\n`);
