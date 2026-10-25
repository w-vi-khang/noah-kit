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
