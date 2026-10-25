import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function withTemporaryProject(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'noah-kit-test-'));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function runCli(root, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args, '--cwd', root], {
    encoding: 'utf8'
  });
}

test('initializes a fresh project with a valid manifest and Claude instructions', async () => {
  await withTemporaryProject(async (root) => {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sample-app' }));
    const result = runCli(root, 'init');

    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(path.join(root, '.noah-kit', 'manifest.json'), 'utf8'));
    const instructions = await readFile(path.join(root, 'CLAUDE.md'), 'utf8');

    assert.equal(manifest.kit.id, 'noah-kit');
    assert.equal(manifest.project.name, 'sample-app');
    assert.ok(manifest.project.id.length > 0);
    assert.match(instructions, /Write all code.*in English/);
    assert.match(result.stdout, /Review and commit these files/);
  });
});

test('is idempotent and preserves an existing valid manifest and Claude instructions', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const manifestPath = path.join(root, '.noah-kit', 'manifest.json');
    const instructionsPath = path.join(root, 'CLAUDE.md');
    const originalManifest = await readFile(manifestPath, 'utf8');
    const originalInstructions = await readFile(instructionsPath, 'utf8');

    const result = runCli(root, 'init');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No changes needed/);
    assert.equal(await readFile(manifestPath, 'utf8'), originalManifest);
    assert.equal(await readFile(instructionsPath, 'utf8'), originalInstructions);
  });
});

test('does not create Claude instructions when an existing manifest is invalid', async () => {
  await withTemporaryProject(async (root) => {
    const configDirectory = path.join(root, '.noah-kit');
    await mkdir(configDirectory, { recursive: true });
    await writeFile(path.join(configDirectory, 'manifest.json'), '{ invalid json');

    const result = runCli(root, 'init');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not valid JSON/);
    await assert.rejects(readFile(path.join(root, 'CLAUDE.md'), 'utf8'), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(configDirectory, 'manifest.json'), 'utf8'), '{ invalid json');
  });
});

test('preserves a user-authored CLAUDE.md and only adds the missing manifest', async () => {
  await withTemporaryProject(async (root) => {
    const instructionsPath = path.join(root, 'CLAUDE.md');
    const originalInstructions = '# Existing project instructions\n';
    await writeFile(instructionsPath, originalInstructions);

    const result = runCli(root, 'init');

    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(instructionsPath, 'utf8'), originalInstructions);
    assert.ok(JSON.parse(await readFile(path.join(root, '.noah-kit', 'manifest.json'), 'utf8')));
    assert.match(result.stdout, /\.noah-kit[\\/]+manifest\.json/);
  });
});

test('rejects unsupported commands without modifying the project', async () => {
  await withTemporaryProject(async (root) => {
    const result = runCli(root, 'update');

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Supported command: init/);
    await assert.rejects(readFile(path.join(root, '.noah-kit', 'manifest.json'), 'utf8'), { code: 'ENOENT' });
  });
});
