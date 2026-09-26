/**
 * Child-process fixture: takes the SQLite write lock (BEGIN IMMEDIATE) and holds it for
 * <holdMs>, committing one row, to prove other processes wait only their bounded busy timeout.
 * argv: <databasePath> <holdMs>
 */
import { SqliteConnection } from '../../src/sqlite/connection.js';

const [dbPath, holdMs] = process.argv.slice(2);
const db = SqliteConnection.open({ path: String(dbPath), busyTimeoutMs: 1_000 });
db.execScript('BEGIN IMMEDIATE');
db.run(`INSERT INTO audit_events (occurred_at, action, entity_type, entity_id, outcome) VALUES ('2026-09-26T12:00:00.000Z', 'test.lock_held', 'test', 'locker', 'OK')`);
process.stdout.write('LOCKED\n');
const until = Date.now() + Number(holdMs);
// A synchronous hold: the lock must stay held regardless of the event loop.
while (Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
db.execScript('COMMIT');
db.close();
process.stdout.write('RELEASED\n');
