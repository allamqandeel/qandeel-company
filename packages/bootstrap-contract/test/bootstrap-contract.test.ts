import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BOOTSTRAP_METADATA, REQUIRED_NODE_MAJOR, checkRuntime } from '../src/index.js';

test('metadata identifies the C0 bootstrap and claims no Company runtime', () => {
  assert.deepEqual(BOOTSTRAP_METADATA, {
    project: 'qandeel-company',
    stage: 'C0',
    nextStage: 'C1',
    companyRuntimeImplemented: false,
  });
  assert.ok(Object.isFrozen(BOOTSTRAP_METADATA));
});

test('Node 24 versions are accepted, with or without a leading v', () => {
  assert.deepEqual(checkRuntime('24.19.0'), { status: 'ok', nodeMajor: 24, requiredNodeMajor: 24 });
  assert.equal(checkRuntime('v24.0.0').status, 'ok');
});

test('other Node majors are rejected', () => {
  for (const version of ['22.23.3', '25.0.0', '26.10.0', '4.0.0']) {
    const result = checkRuntime(version);
    assert.equal(result.status, 'unsupported-runtime', version);
  }
});

test('malformed version strings are reported, not guessed', () => {
  for (const version of ['', '24', '24.x.0', 'latest', '24.1.0-rc.1']) {
    assert.deepEqual(checkRuntime(version), {
      status: 'unparseable-version',
      received: version,
      requiredNodeMajor: REQUIRED_NODE_MAJOR,
    });
  }
});

test('the runtime executing this test is the approved Node line', () => {
  assert.equal(checkRuntime(process.versions.node).status, 'ok', `running on Node ${process.versions.node}`);
});
