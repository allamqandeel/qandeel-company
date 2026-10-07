#!/usr/bin/env node
/**
 * npm run desktop:verify -- --dist <dir>     (D1) re-verifies a built Desktop artifact from its own files:
 *   the Setup SHA-256 against the verification record and the .sha256 file, the Authenticode status against the
 *   record (a FOUNDER-RC must be Valid), and the record's identity against the bundle manifest beside it.
 * Exit 0 only when everything agrees. Prints the content-free verification summary.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { SETUP_NAME, VERIFICATION_SCHEMA, authenticode, sha256File } from './lib/desktop-build.mjs';

const { values } = parseArgs({ options: { dist: { type: 'string' } } });
if (!values.dist) throw new Error('usage: desktop:verify -- --dist <directory holding QANDEEL-COMPANY-Setup.exe>');
const dist = path.resolve(values.dist);
const setup = path.join(dist, `${SETUP_NAME}.exe`);
const problems = [];
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const record = read(path.join(dist, `${SETUP_NAME}.verification.json`));
const bundle = read(path.join(dist, 'qandeel-desktop-bundle.json'));
if (!existsSync(setup)) problems.push('Setup.exe missing');
if (!record || record.schema !== VERIFICATION_SCHEMA) problems.push('verification record missing or of another schema');
if (!bundle) problems.push('bundle manifest missing');
const actual = existsSync(setup) ? sha256File(setup) : null;
if (record && actual !== record.setupSha256) problems.push('Setup SHA-256 differs from the verification record');
const sumFile = path.join(dist, `${SETUP_NAME}.exe.sha256`);
if (!existsSync(sumFile) || readFileSync(sumFile, 'utf8').split(/\s+/)[0] !== actual) problems.push('Setup SHA-256 differs from the .sha256 file');
if (record && bundle) {
  for (const [k, a, b] of [
    ['bundleId', record.bundleId, bundle.bundleId],
    ['releaseId', record.releaseId, bundle.release?.releaseId],
    ['sourceCommit', record.sourceCommit, bundle.source?.commit],
    ['node.sha256', record.node?.sha256, bundle.node?.sha256],
    ['desktopVersion', record.desktopVersion, bundle.desktopVersion],
  ]) if (a !== b) problems.push(`${k} differs between the record and the bundle manifest`);
}
const signature = existsSync(setup) ? authenticode(setup) : null;
if (record && signature && signature.status !== record.authenticode?.status) problems.push(`Authenticode status ${signature.status} differs from the record (${record.authenticode?.status})`);
if (record?.artifactClass === 'FOUNDER-RC' && signature?.status !== 'Valid') problems.push('a FOUNDER-RC must carry a valid, trusted Authenticode signature');
const summary = { ok: problems.length === 0, artifact: `${SETUP_NAME}.exe`, setupSha256: actual, artifactClass: record?.artifactClass ?? null, authenticode: signature?.status ?? null, signer: signature?.signer ?? null, sourceCommit: record?.sourceCommit ?? null, desktopVersion: record?.desktopVersion ?? null, releaseId: record?.releaseId ?? null, node: record?.node ?? null, problems };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (problems.length) process.exitCode = 1;
