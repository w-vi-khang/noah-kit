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
    encoding: 'utf8',
    env: { ...process.env, NOAH_HOME: path.join(root, '.test-noah-home') }
  });
}

test('initializes a fresh project with a valid manifest and Claude Code rule', async () => {
  await withTemporaryProject(async (root) => {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sample-app' }));
    const result = runCli(root, 'init');

    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(path.join(root, '.noah-kit', 'manifest.json'), 'utf8'));
    const instructions = await readFile(path.join(root, '.claude', 'rules', 'noah-kit.md'), 'utf8');
    const canonicalInstructions = await readFile(path.resolve(path.dirname(cliPath), '..', '.claude', 'rules', 'noah-kit.md'), 'utf8');

    assert.equal(instructions.replace(/\r\n/g, '\n'), canonicalInstructions.replace(/\r\n/g, '\n'));
    assert.equal(manifest.kit.id, 'noah-kit');
    assert.equal(manifest.project.name, 'sample-app');
    assert.ok(manifest.project.id.length > 0);
    assert.match(instructions, /Write all code.*in English/);
    assert.match(result.stdout, /Review and commit these files/);
  });
});

test('is idempotent and preserves an existing manifest and generated Claude Code rule', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const manifestPath = path.join(root, '.noah-kit', 'manifest.json');
    const instructionsPath = path.join(root, '.claude', 'rules', 'noah-kit.md');
    const originalManifest = await readFile(manifestPath, 'utf8');
    const originalInstructions = await readFile(instructionsPath, 'utf8');

    const result = runCli(root, 'init');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No changes needed/);
    assert.equal(await readFile(manifestPath, 'utf8'), originalManifest);
    assert.equal(await readFile(instructionsPath, 'utf8'), originalInstructions);
  });
});

test('does not create a Claude Code rule when an existing manifest is invalid', async () => {
  await withTemporaryProject(async (root) => {
    const configDirectory = path.join(root, '.noah-kit');
    await mkdir(configDirectory, { recursive: true });
    await writeFile(path.join(configDirectory, 'manifest.json'), '{ invalid json');

    const result = runCli(root, 'init');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not valid JSON/);
    await assert.rejects(readFile(path.join(root, '.claude', 'rules', 'noah-kit.md'), 'utf8'), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(configDirectory, 'manifest.json'), 'utf8'), '{ invalid json');
  });
});

test('preserves a user-authored CLAUDE.md and adds a separate Noah Kit rule', async () => {
  await withTemporaryProject(async (root) => {
    const instructionsPath = path.join(root, 'CLAUDE.md');
    const originalInstructions = '# Existing project instructions\n';
    await writeFile(instructionsPath, originalInstructions);

    const result = runCli(root, 'init');

    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(instructionsPath, 'utf8'), originalInstructions);
    assert.ok(JSON.parse(await readFile(path.join(root, '.noah-kit', 'manifest.json'), 'utf8')));
    assert.ok(await readFile(path.join(root, '.claude', 'rules', 'noah-kit.md'), 'utf8'));
    assert.match(result.stdout, /\.noah-kit[\\/]+manifest\.json/);
  });
});

test('rejects unsupported commands without modifying the project', async () => {
  await withTemporaryProject(async (root) => {
    const result = runCli(root, 'update');

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Supported commands: init, install, status, decline, onboarding, link/);
    await assert.rejects(readFile(path.join(root, '.noah-kit', 'manifest.json'), 'utf8'), { code: 'ENOENT' });
  });
});


test('installs the Core into user-local storage without changing project files', async () => {
  await withTemporaryProject(async (root) => {
    const result = runCli(root, 'install');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Noah Kit Core 0\.1\.0 is installed/);

    const home = path.join(root, '.test-noah-home');
    const installPath = path.join(home, 'versions', '0.1.0');
    const marker = JSON.parse(await readFile(path.join(installPath, 'core-manifest.json'), 'utf8'));
    const state = JSON.parse(await readFile(path.join(home, 'state.json'), 'utf8'));

    assert.equal(marker.version, '0.1.0');
    assert.equal(state.installations['0.1.0'].path, installPath);
    assert.ok(await readFile(path.join(installPath, 'src', 'cli.js'), 'utf8'));
    await assert.rejects(readFile(path.join(root, '.noah-kit', 'manifest.json'), 'utf8'), { code: 'ENOENT' });
  });
});

test('registers an existing valid Core installation without overwriting it', async () => {
  await withTemporaryProject(async (root) => {
    const first = runCli(root, 'install');
    assert.equal(first.status, 0, first.stderr);
    const installPath = path.join(root, '.test-noah-home', 'versions', '0.1.0');
    const sourcePath = path.join(installPath, 'src', 'cli.js');
    const originalSource = await readFile(sourcePath, 'utf8');

    const second = runCli(root, 'install');

    assert.equal(second.status, 0, second.stderr);
    assert.equal(await readFile(sourcePath, 'utf8'), originalSource);
    assert.match(second.stdout, /Noah Kit Core 0\.1\.0 is installed/);
  });
});

test('refuses to overwrite an unmarked existing Core directory', async () => {
  await withTemporaryProject(async (root) => {
    const installPath = path.join(root, '.test-noah-home', 'versions', '0.1.0');
    await mkdir(installPath, { recursive: true });
    await writeFile(path.join(installPath, 'user-file.txt'), 'keep this file');

    const result = runCli(root, 'install');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /without a valid Noah Kit marker/);
    assert.equal(await readFile(path.join(installPath, 'user-file.txt'), 'utf8'), 'keep this file');
  });
});

test('status reports local Core and project configuration', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    assert.equal(runCli(root, 'install').status, 0);

    const result = runCli(root, 'status');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Core 0\.1\.0: installed/);
    assert.match(result.stdout, /Project: .*\(/);
    assert.match(result.stdout, /Project registration: known locally/);
  });
});

test('does not install Core when the project manifest is invalid', async () => {
  await withTemporaryProject(async (root) => {
    await mkdir(path.join(root, '.noah-kit'), { recursive: true });
    await writeFile(path.join(root, '.noah-kit', 'manifest.json'), '{invalid');

    const result = runCli(root, 'install');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not valid JSON/);
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'versions', '0.1.0', 'core-manifest.json'), 'utf8'), { code: 'ENOENT' });
  });
});


test('records declined installation locally without changing committed project configuration', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const manifestPath = path.join(root, '.noah-kit', 'manifest.json');
    const originalManifest = await readFile(manifestPath, 'utf8');

    const result = runCli(root, 'decline');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Installation decline recorded in user-local state/);
    assert.equal(await readFile(manifestPath, 'utf8'), originalManifest);

    const state = JSON.parse(await readFile(path.join(root, '.test-noah-home', 'state.json'), 'utf8'));
    const manifest = JSON.parse(originalManifest);
    assert.ok(state.projects[manifest.project.id].declined_install_at);
    assert.equal(state.projects[manifest.project.id].declined_remind_after_days, manifest.updates.remind_after_days);
  });
});

test('refuses to record a declined installation without project configuration', async () => {
  await withTemporaryProject(async (root) => {
    const result = runCli(root, 'decline');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Initialize the project before recording an installation choice/);
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'state.json'), 'utf8'), { code: 'ENOENT' });
  });
});


test('rejects an incompatible Core version range before writing local installation files', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const manifestPath = path.join(root, '.noah-kit', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.kit.core_version_range = '<0.1.0';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runCli(root, 'install');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not satisfy the project's required range/);
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'versions', '0.1.0', 'core-manifest.json'), 'utf8'), { code: 'ENOENT' });
  });
});

test('rejects unsupported Core version range syntax rather than guessing', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const manifestPath = path.join(root, '.noah-kit', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.kit.core_version_range = '^0.1.0';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runCli(root, 'install');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported Core version range syntax/);
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'versions', '0.1.0', 'core-manifest.json'), 'utf8'), { code: 'ENOENT' });
  });
});


test('onboarding reports when the current directory is not a Noah Kit project', async () => {
  await withTemporaryProject(async (root) => {
    const result = runCli(root, 'onboarding');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /NO_KIT_PROJECT/);
  });
});

test('onboarding prompts for installation when no compatible Core is installed', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const result = runCli(root, 'onboarding');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PROMPT_INSTALL/);
  });
});

test('onboarding suppresses prompts during the local decline reminder interval', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    assert.equal(runCli(root, 'decline').status, 0);
    const result = runCli(root, 'onboarding');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /INSTALL_DECLINED/);
  });
});

test('onboarding prompts again after the recorded decline interval expires', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    assert.equal(runCli(root, 'decline').status, 0);
    const statePath = path.join(root, '.test-noah-home', 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const manifest = JSON.parse(await readFile(path.join(root, '.noah-kit', 'manifest.json'), 'utf8'));
    state.projects[manifest.project.id].declined_install_at = '2000-01-01T00:00:00.000Z';
    await writeFile(statePath, JSON.stringify(state, null, 2));

    const result = runCli(root, 'onboarding');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PROMPT_INSTALL/);
  });
});

test('onboarding recognizes an installed compatible Core', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    assert.equal(runCli(root, 'install').status, 0);
    const result = runCli(root, 'onboarding');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /CORE_READY/);
  });
});

test('onboarding does not recommend a Core release that violates the project range', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const manifestPath = path.join(root, '.noah-kit', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.kit.core_version_range = '>=0.2.0';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runCli(root, 'onboarding');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /NO_COMPATIBLE_RELEASE/);
  });
});


test('successful installation clears a previous declined-install choice', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    assert.equal(runCli(root, 'decline').status, 0);
    assert.equal(runCli(root, 'install').status, 0);

    const state = JSON.parse(await readFile(path.join(root, '.test-noah-home', 'state.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(path.join(root, '.noah-kit', 'manifest.json'), 'utf8'));
    const projectState = state.projects[manifest.project.id];

    assert.equal(projectState.installed_version, '0.1.0');
    assert.equal('declined_install_at' in projectState, false);
    assert.equal('declined_remind_after_days' in projectState, false);
  });
});


test('creates managed cross-platform launchers and dispatches to installed Core', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'install').status, 0);
    const result = runCli(root, 'link');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Add this directory to your PATH manually/);

    const home = path.join(root, '.test-noah-home');
    const binDirectory = path.join(home, 'bin');
    const dispatcherPath = path.join(binDirectory, 'noah.js');
    const unixLauncherPath = path.join(binDirectory, 'noah');
    const windowsLauncherPath = path.join(binDirectory, 'noah.cmd');
    assert.match(await readFile(dispatcherPath, 'utf8'), /NOAH_KIT_MANAGED_LAUNCHER/);
    if (process.platform === 'win32') {
      await assert.rejects(readFile(unixLauncherPath, 'utf8'), { code: 'ENOENT' });
    } else {
      assert.match(await readFile(unixLauncherPath, 'utf8'), /NOAH_KIT_MANAGED_LAUNCHER/);
    }
    assert.match(await readFile(windowsLauncherPath, 'utf8'), /NOAH_KIT_MANAGED_LAUNCHER/);

    const dispatched = spawnSync(process.execPath, [dispatcherPath, '--version'], {
      encoding: 'utf8',
      env: { ...process.env, NOAH_HOME: home }
    });
    assert.equal(dispatched.status, 0, dispatched.stderr);
    assert.match(dispatched.stdout, /^0\.1\.0\s*$/);
  });
});

test('refuses to overwrite an unmanaged launcher file', async () => {
  await withTemporaryProject(async (root) => {
    const home = path.join(root, '.test-noah-home');
    const binDirectory = path.join(home, 'bin');
    await mkdir(binDirectory, { recursive: true });
    const existingPath = path.join(binDirectory, 'noah.js');
    await writeFile(existingPath, 'user-owned content');
    const result = runCli(root, 'link');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing to overwrite an unmanaged file/);
    assert.equal(await readFile(existingPath, 'utf8'), 'user-owned content');
  });
});
