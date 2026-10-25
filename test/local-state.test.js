import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getNoahHome, getStatePath, loadLocalState, saveLocalState } from '../src/local-state.js';

async function withTemporaryHome(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'noah-state-test-'));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('uses an explicit NOAH_HOME when configured', () => {
  assert.equal(getNoahHome({ NOAH_HOME: '/tmp/noah-custom' }, '/home/test'), path.resolve('/tmp/noah-custom'));
});

test('defaults local state outside the project directory', () => {
  assert.equal(getNoahHome({}, '/home/test'), path.resolve(path.join('/home/test', '.noah-kit')));
});

test('loads an empty state when no state file exists', async () => {
  await withTemporaryHome(async (root) => {
    const state = await loadLocalState(root);
    assert.deepEqual(state, {
      schema_version: 1,
      installations: {},
      projects: {}
    });
  });
});

test('saves and reloads local state without losing entries', async () => {
  await withTemporaryHome(async (root) => {
    const state = await loadLocalState(root);
    state.installations['0.1.0'] = {
      version: '0.1.0',
      path: '/tmp/noah-kit/versions/0.1.0',
      installed_at: '2026-10-26T00:00:00.000Z'
    };
    state.projects['sample-project'] = {
      declined_install_at: '2026-10-26T00:00:00.000Z'
    };

    await saveLocalState(root, state);
    assert.deepEqual(await loadLocalState(root), state);
    assert.equal(JSON.parse(await readFile(getStatePath(root), 'utf8')).schema_version, 1);
  });
});

test('preserves invalid state instead of silently resetting it', async () => {
  await withTemporaryHome(async (root) => {
    const statePath = getStatePath(root);
    await writeFile(statePath, '{invalid');

    await assert.rejects(loadLocalState(root), /invalid JSON/);
    assert.equal(await readFile(statePath, 'utf8'), '{invalid');
  });
});

test('rejects an unsupported state schema', async () => {
  await withTemporaryHome(async (root) => {
    await writeFile(getStatePath(root), JSON.stringify({
      schema_version: 99,
      installations: {},
      projects: {}
    }));

    await assert.rejects(loadLocalState(root), /Unsupported local state schema/);
  });
});


test('rejects malformed installation records rather than trusting their paths', async () => {
  await withTemporaryHome(async (root) => {
    await writeFile(getStatePath(root), JSON.stringify({
      schema_version: 1,
      installations: {
        latest: { version: 'latest', path: '/tmp/noah-kit' }
      },
      projects: {}
    }));

    await assert.rejects(loadLocalState(root), /invalid Core installation entry/);
  });
});

test('round-trips optional update check records', async () => {
  await withTemporaryHome(async (root) => {
    const state = await loadLocalState(root);
    state.update_checks = {
      stable: {
        source: 'https://example.com/releases.json',
        last_attempt_at: '2026-10-26T17:00:00.000Z',
        last_success_at: '2026-10-26T17:00:00.000Z',
        last_result: 'UPDATE_AVAILABLE',
        latest_known_version: '0.1.1'
      }
    };

    await saveLocalState(root, state);
    assert.deepEqual(await loadLocalState(root), state);
  });
});

test('rejects malformed update check records', async () => {
  await withTemporaryHome(async (root) => {
    const base = { schema_version: 1, installations: {}, projects: {} };
    const cases = [
      [{ ...base, update_checks: [] }, /update_checks must be an object/],
      [{ ...base, update_checks: { stable: { last_result: 'MAYBE' } } }, /last_result is not supported/],
      [{ ...base, update_checks: { stable: { last_success_at: 'yesterday' } } }, /ISO 8601/],
      [{ ...base, update_checks: { stable: { last_attempt_at: 'Nov 1 2026' } } }, /ISO 8601/],
      [{ ...base, update_checks: { stable: { latest_known_version: 'latest' } } }, /stable version or null/],
      [{ ...base, update_checks: { 'Bad Channel': {} } }, /invalid update check entry/]
    ];
    for (const [candidate, pattern] of cases) {
      await writeFile(getStatePath(root), JSON.stringify(candidate));
      await assert.rejects(loadLocalState(root), pattern);
    }
  });
});
