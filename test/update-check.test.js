import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../src/main.js', import.meta.url));
const COMMIT = 'ff353d7c6a6141016dce60a05cb030c91dfc7a9f';

async function withTemporaryProject(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'noah-update-test-'));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function runCli(root, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args, '--cwd', root], {
    encoding: 'utf8',
    env: { ...process.env, NOAH_HOME: path.join(root, '.test-noah-home') }
  });
}

function release(version, overrides = {}) {
  return {
    version,
    channel: 'stable',
    published_at: '2026-10-26T00:00:00.000Z',
    classification: 'patch',
    source: { type: 'git', repository: 'github:w-vi-khang/noah-kit', commit: COMMIT },
    ...overrides
  };
}

async function writeIndex(root, releases) {
  const indexPath = path.join(root, 'releases.json');
  await writeFile(indexPath, JSON.stringify({ schema_version: 1, kit_id: 'noah-kit', releases }));
  return indexPath;
}

async function readState(root) {
  return JSON.parse(await readFile(path.join(root, '.test-noah-home', 'state.json'), 'utf8'));
}

async function updateManifest(root, mutate) {
  const manifestPath = path.join(root, '.noah-kit', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  mutate(manifest);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

test('reports a compatible update without downloading or installing it', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const manifestPath = path.join(root, '.noah-kit', 'manifest.json');
    const originalManifest = await readFile(manifestPath, 'utf8');
    const indexPath = await writeIndex(root, [release('0.1.2'), release('0.2.0', { classification: 'breaking' })]);

    const result = runCli(root, 'update-check', '--source', indexPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^UPDATE_AVAILABLE: Core 0\.1\.2 \(patch/);
    assert.match(result.stdout, /Nothing was downloaded or installed/);
    assert.equal(await readFile(manifestPath, 'utf8'), originalManifest);
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'versions', '0.1.2', 'core-manifest.json')), { code: 'ENOENT' });

    const record = (await readState(root)).update_checks.stable;
    assert.equal(record.last_result, 'UPDATE_AVAILABLE');
    assert.equal(record.latest_known_version, '0.1.2');
    assert.equal(record.last_success_at, record.last_attempt_at);
    assert.equal(record.source, indexPath);
    assert.match(result.stderr, /non-default release source/);
  });
});

test('does not check again before the next scheduled slot', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const indexPath = await writeIndex(root, [release('0.1.2')]);
    assert.equal(runCli(root, 'update-check', '--source', indexPath).status, 0);
    const statePath = path.join(root, '.test-noah-home', 'state.json');
    const stateAfterFirstCheck = await readFile(statePath, 'utf8');

    const result = runCli(root, 'update-check', '--source', indexPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^CHECK_NOT_DUE: .*\(NOT_DUE\)/);
    assert.equal(await readFile(statePath, 'utf8'), stateAfterFirstCheck);

    const forced = runCli(root, 'update-check', '--source', indexPath, '--force');
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /^UPDATE_AVAILABLE/);
  });
});

test('reports UP_TO_DATE when no newer compatible release exists', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const indexPath = await writeIndex(root, [release('0.1.0'), release('0.1.1'), release('0.2.0'), release('0.1.5', { channel: 'beta' })]);

    const result = runCli(root, 'update-check', '--source', indexPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^UP_TO_DATE: no stable release newer than 0\.1\.1/);
    const record = (await readState(root)).update_checks.stable;
    assert.equal(record.last_result, 'UP_TO_DATE');
    assert.equal(record.latest_known_version, null);
  });
});

test('records a malformed release index as a failure and backs off', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const indexPath = await writeIndex(root, [release('0.1.2', { source: { type: 'git', repository: 'github:w-vi-khang/noah-kit', commit: 'short' } })]);

    const result = runCli(root, 'update-check', '--source', indexPath);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /^CHECK_FAILED: .*40-character/);
    const record = (await readState(root)).update_checks.stable;
    assert.equal(record.last_result, 'FAILED');
    assert.match(record.last_error, /40-character/);
    assert.equal(record.last_success_at, undefined);

    const retry = runCli(root, 'update-check', '--source', indexPath);
    assert.equal(retry.status, 0, retry.stderr);
    assert.match(retry.stdout, /^CHECK_NOT_DUE: .*\(BACKOFF\)/);
  });
});

test('records an unreachable release source as a failure', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);

    const result = runCli(root, 'update-check', '--source', 'https://127.0.0.1:9/releases.json');

    assert.equal(result.status, 1);
    assert.match(result.stdout, /^CHECK_FAILED: Could not reach the release source/);
    assert.equal((await readState(root)).update_checks.stable.last_result, 'FAILED');
  });
});

test('rejects a non-https release source before writing local state', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);

    const result = runCli(root, 'update-check', '--source', 'http://example.com/releases.json');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /must use https:\/\//);
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'state.json')), { code: 'ENOENT' });
  });
});

test('preserves invalid local state instead of overwriting it', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const indexPath = await writeIndex(root, [release('0.1.2')]);
    const home = path.join(root, '.test-noah-home');
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, 'state.json'), '{invalid');

    const result = runCli(root, 'update-check', '--source', indexPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid JSON/);
    assert.equal(await readFile(path.join(home, 'state.json'), 'utf8'), '{invalid');
  });
});

test('keeps existing installations and projects and compares against the installed Core', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    assert.equal(runCli(root, 'install').status, 0);
    const before = await readState(root);
    const indexPath = await writeIndex(root, [release('0.1.0'), release('0.1.1')]);

    const result = runCli(root, 'update-check', '--source', indexPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^UP_TO_DATE: no stable release newer than 0\.1\.1/);
    const after = await readState(root);
    assert.deepEqual(after.installations, before.installations);
    assert.deepEqual(after.projects, before.projects);
  });
});

test('honors a disabled check policy unless the check is forced', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    await updateManifest(root, (manifest) => { manifest.updates.check_on_startup = false; });
    const indexPath = await writeIndex(root, [release('0.1.2')]);

    const disabled = runCli(root, 'update-check', '--source', indexPath);
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.match(disabled.stdout, /^CHECK_DISABLED/);
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'state.json')), { code: 'ENOENT' });

    const forced = runCli(root, 'update-check', '--source', indexPath, '--force');
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /^UPDATE_AVAILABLE/);
  });
});

test('mentions that auto_install is ignored when an update is available', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    await updateManifest(root, (manifest) => { manifest.updates.auto_install = true; });
    const indexPath = await writeIndex(root, [release('0.1.2')]);

    const result = runCli(root, 'update-check', '--source', indexPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /updates\.auto_install is ignored/);
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'versions', '0.1.2', 'core-manifest.json')), { code: 'ENOENT' });
  });
});

test('fails closed on an unsupported schedule timezone', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    await updateManifest(root, (manifest) => { manifest.updates.timezone = 'Asia/Ho_Chi_Minh'; });
    const indexPath = await writeIndex(root, [release('0.1.2')]);

    const result = runCli(root, 'update-check', '--source', indexPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported updates\.timezone/);
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'state.json')), { code: 'ENOENT' });
  });
});

test('rejects update-check options on other commands', async () => {
  await withTemporaryProject(async (root) => {
    const result = runCli(root, 'status', '--force');

    assert.equal(result.status, 2);
    assert.match(result.stderr, /only supported by update-check/);
  });
});

test('a check against one source does not suppress a check against another', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const firstPath = await writeIndex(root, []);
    assert.equal(runCli(root, 'update-check', '--source', firstPath).status, 0);
    const secondPath = path.join(root, 'mirror.json');
    await writeFile(secondPath, JSON.stringify({ schema_version: 1, kit_id: 'noah-kit', releases: [release('0.1.2')] }));

    const result = runCli(root, 'update-check', '--source', secondPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^UPDATE_AVAILABLE/);
    assert.equal((await readState(root)).update_checks.stable.source, secondPath);
  });
});

test('fails closed on unsupported range syntax before writing local state', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    await updateManifest(root, (manifest) => { manifest.kit.core_version_range = '^0.1.0'; });
    const indexPath = await writeIndex(root, [release('0.2.0')]);

    const result = runCli(root, 'update-check', '--source', indexPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported Core version range syntax/);
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'state.json')), { code: 'ENOENT' });
  });
});

test('fails closed on a null updates block', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    await updateManifest(root, (manifest) => { manifest.updates = null; });
    const indexPath = await writeIndex(root, [release('0.1.2')]);

    const result = runCli(root, 'update-check', '--source', indexPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /updates field must be an object/);
  });
});
