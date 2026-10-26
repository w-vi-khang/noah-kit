import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerification, getCurrentVerificationStatus } from '../src/verification.js';

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function fixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'noah-verify-test-'));
  try {
    await mkdir(path.join(root, '.noah-kit'), { recursive: true });
    await writeFile(path.join(root, 'sample.txt'), 'baseline\n');
    await writeFile(path.join(root, 'check.js'), 'process.stdout.write("check passed");\\n');
    await writeFile(path.join(root, 'fail.js'), 'process.stderr.write("expected failure"); process.exitCode = 7;\\n');
    const manifest = {
      schema_version: 1,
      kit: { id: 'noah-kit', core_version_range: '>=0.1.0 <0.2.0' },
      project: { id: 'test-project', name: 'Verification test', type: 'application' },
      verification: { commands: { check: [process.execPath, '-e', 'process.stdout.write("check passed")'] } }
    };
    await writeFile(path.join(root, '.noah-kit', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    git(root, 'init');
    git(root, 'config', 'user.email', 'noah-test@example.invalid');
    git(root, 'config', 'user.name', 'Noah Kit Test');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'Initial verification fixture');
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('verification runner saves output and detects source changes after the run', async () => {
  await fixture(async (root) => {
    const exitCode = await runVerification(root, 'check');
    assert.equal(exitCode, 0);
    const record = JSON.parse(await readFile(path.join(root, '.noah-kit', 'verification', 'latest.json'), 'utf8'));
    assert.equal(record.status, 'PASSED');
    assert.equal(record.exit_code, 0);
    assert.equal(record.name, 'check');
    assert.match(await readFile(path.join(root, record.log), 'utf8'), /check passed/);
    const status = await getCurrentVerificationStatus(root);
    assert.equal(status.current, true, status.reason);
    await writeFile(path.join(root, 'sample.txt'), 'changed after verification\n');
    const stale = await getCurrentVerificationStatus(root);
    assert.equal(stale.current, false);
    assert.match(stale.reason, /differ from the recorded verification/);
  });
});

test('verification status rejects a modified saved log', async () => {
  await fixture(async (root) => {
    assert.equal(await runVerification(root, 'check'), 0);
    const record = JSON.parse(await readFile(path.join(root, '.noah-kit', 'verification', 'latest.json'), 'utf8'));
    await writeFile(path.join(root, record.log), 'edited log content');
    const status = await getCurrentVerificationStatus(root);
    assert.equal(status.current, false);
    assert.match(status.reason, /log changed/);
  });
});

test('verification runner records failing checks without calling them passed', async () => {
  await fixture(async (root) => {
    const manifestPath = path.join(root, '.noah-kit', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.verification.commands.check = [process.execPath, '-e', 'process.stderr.write("expected failure"); process.exitCode = 7'];
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    git(root, 'add', '.noah-kit/manifest.json');
    git(root, 'commit', '-m', 'Configure failing verification command');
    const exitCode = await runVerification(root, 'check');
    assert.equal(exitCode, 1);
    const record = JSON.parse(await readFile(path.join(root, '.noah-kit', 'verification', 'latest.json'), 'utf8'));
    assert.equal(record.status, 'FAILED');
    assert.equal(record.exit_code, 7);
    assert.equal((await getCurrentVerificationStatus(root)).current, false);
  });
});

test('verification runner rejects an unconfigured command name', async () => {
  await fixture(async (root) => {
    await assert.rejects(runVerification(root, 'missing'), /Unknown verification command/);
  });
});
