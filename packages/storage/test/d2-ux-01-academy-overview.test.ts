/**
 * D2-UX-01 — the company-wide Academy overview is a read of the canonical records and nothing else: it reports the
 * learning path, attempts, scores, certification, the Skill Passport and what the role's blueprint requires exactly as
 * the C3 stores hold them, leaves every table byte-identical (no enrollment, attempt, certification, passport, budget,
 * lifecycle, Work Item, job, audit or event row is written), and carries no answer or scenario content.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import { academyOverview } from '../src/index.js';
import { storeContext, type CompanyStore } from '../src/store.js';
import { seed } from './c2-helpers.js';
import { ANSWER, academyWorld, certify } from './c3-helpers.js';
import { harness } from './helpers.js';

/** Every table's every row, hashed: the whole durable state in one digest. */
function stateDigest(store: CompanyStore): string {
  const db = storeContext(store).db;
  const hash = createHash('sha256');
  for (const { name } of db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)) {
    hash.update(name);
    // Rows sorted by their own serialisation: WITHOUT ROWID tables have no rowid to order by.
    for (const row of db.all(`SELECT * FROM "${name}"`).map((r) => JSON.stringify(r, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).sort()) hash.update(row);
  }
  return hash.digest('hex');
}

describe('D2-UX-01: the Academy overview', () => {
  test('reports the canonical learning path truthfully and writes nothing', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      const w = academyWorld(h, s);
      certify(h, s, s.employee, w);
      const before = stateDigest(h.store);
      const all = academyOverview(h.store);
      const one = academyOverview(h.store, { employeeId: s.employee.id });
      assert.equal(stateDigest(h.store), before, 'reading the Academy changes no durable state at all');

      const e = all.employees.find((x) => x.employeeId === s.employee.id);
      assert.ok(e, 'the certified employee is listed');
      assert.equal(e.lifecycle, storeContext(h.store).db.get<{ state: string }>('SELECT state FROM employees WHERE id = ?', s.employee.id)?.state, 'the lifecycle as recorded');
      assert.equal(e.enrollment?.stage, 'ACTIVATION_APPROVAL');
      assert.equal(e.enrollment?.modulesDone, 6);
      assert.equal(e.enrollment?.modulesTotal, 6);
      assert.deepEqual(e.enrollment?.attempts.map((a) => `${a.kind}:${a.state}:${a.outcome}`), ['SIMULATION:EVALUATED:PASS', 'ASSESSMENT:EVALUATED:PASS']);
      assert.ok(e.enrollment?.attempts.every((a) => typeof a.averagePct === 'number'));
      assert.equal(e.enrollment?.activationRequest, 'PENDING_APPROVAL');
      assert.equal(e.certification?.status, 'VALID');
      assert.deepEqual(e.skills.map((k) => `${k.code}:${k.proficiency}`), ['market.research:QUALIFIED']);
      assert.deepEqual(e.roleRequires.map((r) => `${r.code}:${r.minProficiency}:${r.critical}`), ['market.research:QUALIFIED:true']);
      assert.equal(e.work.total >= 4, true, 'two attempts and two shadow cases are this employee\'s work on record');
      assert.deepEqual(all.programs.map((p) => `${p.code}:${p.modules}:${p.scenarios}:${p.enrollments}`), ['program.analyst.market.research:6:4:1']);
      assert.deepEqual(all.totals, { employees: all.employees.length, enrolled: 1, certifiedValid: 1, attemptsEvaluated: 2, attemptsPassed: 2, packagesInstalled: 0 });
      // Employees who never entered the Academy read as such — never filled in.
      for (const x of all.employees.filter((y) => y.employeeId !== s.employee.id)) {
        assert.equal(x.enrollment, null);
        assert.equal(x.certification, null);
      }

      // One employee's slice (the profile sheet) is the same facts, without the company-wide lists.
      assert.equal(one.employees.length, 1);
      assert.deepEqual(one.employees[0], e);
      assert.deepEqual(one.packages, []);
      assert.deepEqual(one.programs, []);

      // Content-minimal: no answer and no scenario content reaches the overview.
      const text = JSON.stringify(all);
      assert.equal(text.includes(ANSWER.body), false, 'no answer body');
      assert.equal(text.includes('a realistic'), false, 'no scenario content');
    } finally {
      h.close();
    }
  });

  test('an empty Company reads as empty', () => {
    const h = harness();
    try {
      const before = stateDigest(h.store);
      const v = academyOverview(h.store);
      assert.equal(stateDigest(h.store), before);
      assert.deepEqual(v.employees, []);
      assert.deepEqual(v.packages, []);
      assert.deepEqual(v.programs, []);
      assert.deepEqual(v.totals, { employees: 0, enrolled: 0, certifiedValid: 0, attemptsEvaluated: 0, attemptsPassed: 0, packagesInstalled: 0 });
    } finally {
      h.close();
    }
  });
});
