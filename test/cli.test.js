import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cliPath = fileURLToPath(new URL('../src/main.js', import.meta.url));
const CORE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const CORE_VERSION_PATTERN = CORE_VERSION.replace(/\./g, '\\.');

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
    assert.match(instructions, /MUST be in English/);
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
    assert.match(result.stderr, /Supported commands: init, install, status, decline, onboarding, link, update-check, language/);
    await assert.rejects(readFile(path.join(root, '.noah-kit', 'manifest.json'), 'utf8'), { code: 'ENOENT' });
  });
});


test('installs the Core into user-local storage without changing project files', async () => {
  await withTemporaryProject(async (root) => {
    const result = runCli(root, 'install');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Noah Kit Core ${CORE_VERSION_PATTERN} is installed`));

    const home = path.join(root, '.test-noah-home');
    const installPath = path.join(home, 'versions', CORE_VERSION);
    const marker = JSON.parse(await readFile(path.join(installPath, 'core-manifest.json'), 'utf8'));
    const state = JSON.parse(await readFile(path.join(home, 'state.json'), 'utf8'));

    assert.equal(marker.version, CORE_VERSION);
    assert.equal(state.installations[CORE_VERSION].path, installPath);
    assert.ok(await readFile(path.join(installPath, 'src', 'cli.js'), 'utf8'));
    await assert.rejects(readFile(path.join(root, '.noah-kit', 'manifest.json'), 'utf8'), { code: 'ENOENT' });
  });
});

test('registers an existing valid Core installation without overwriting it', async () => {
  await withTemporaryProject(async (root) => {
    const first = runCli(root, 'install');
    assert.equal(first.status, 0, first.stderr);
    const installPath = path.join(root, '.test-noah-home', 'versions', CORE_VERSION);
    const sourcePath = path.join(installPath, 'src', 'cli.js');
    const originalSource = await readFile(sourcePath, 'utf8');

    const second = runCli(root, 'install');

    assert.equal(second.status, 0, second.stderr);
    assert.equal(await readFile(sourcePath, 'utf8'), originalSource);
    assert.match(second.stdout, new RegExp(`Noah Kit Core ${CORE_VERSION_PATTERN} is installed`));
  });
});

test('refuses to overwrite an unmarked existing Core directory', async () => {
  await withTemporaryProject(async (root) => {
    const installPath = path.join(root, '.test-noah-home', 'versions', CORE_VERSION);
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
    assert.match(result.stdout, new RegExp(`Core ${CORE_VERSION_PATTERN}: installed`));
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
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'versions', CORE_VERSION, 'core-manifest.json'), 'utf8'), { code: 'ENOENT' });
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
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'versions', CORE_VERSION, 'core-manifest.json'), 'utf8'), { code: 'ENOENT' });
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
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'versions', CORE_VERSION, 'core-manifest.json'), 'utf8'), { code: 'ENOENT' });
  });
});


test('onboarding reports when the current directory is not a Noah Kit project', async () => {
  await withTemporaryProject(async (root) => {
    const result = runCli(root, 'onboarding');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /NO_KIT_PROJECT/);
    assert.match(result.stdout, /\n$/);
    assert.doesNotMatch(result.stdout, /\\n/);
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
    assert.match(result.stdout, /\n$/);
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

    assert.equal(projectState.installed_version, CORE_VERSION);
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
    assert.match(dispatched.stdout, new RegExp(`^${CORE_VERSION_PATTERN}\\s*$`));
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

test('stores the communication language in user-local state only', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const manifestPath = path.join(root, '.noah-kit', 'manifest.json');
    const originalManifest = await readFile(manifestPath, 'utf8');

    const unset = runCli(root, 'language');
    assert.equal(unset.status, 0, unset.stderr);
    assert.match(unset.stdout, /Communication language: not set/);

    const set = runCli(root, 'language', 'vi');
    assert.equal(set.status, 0, set.stderr);
    assert.match(set.stdout, /Communication language set to vi/);
    assert.match(set.stdout, /code and technical artifacts stay in English/);
    assert.equal(await readFile(manifestPath, 'utf8'), originalManifest);

    const state = JSON.parse(await readFile(path.join(root, '.test-noah-home', 'state.json'), 'utf8'));
    assert.equal(state.preferences.communication_language, 'vi');

    const shown = runCli(root, 'language');
    assert.match(shown.stdout, /Communication language: vi\b/);
    assert.match(runCli(root, 'status').stdout, /Communication language: vi\b/);
  });
});

test('canonicalizes language tags and clears the preference', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'language', 'PT-br').status, 0);
    const statePath = path.join(root, '.test-noah-home', 'state.json');
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).preferences.communication_language, 'pt-BR');

    const cleared = runCli(root, 'language', 'clear');
    assert.equal(cleared.status, 0, cleared.stderr);
    assert.equal('communication_language' in JSON.parse(await readFile(statePath, 'utf8')).preferences, false);
    assert.match(runCli(root, 'language').stdout, /not set/);
  });
});

test('rejects invalid language tags without writing local state', async () => {
  await withTemporaryProject(async (root) => {
    for (const tag of ['vietnamese', 'v', 'vi_VN', 'vi-VN-extra-subtag']) {
      const result = runCli(root, 'language', tag);
      assert.equal(result.status, 1, tag);
      assert.match(result.stderr, /Unsupported language tag/);
    }
    await assert.rejects(readFile(path.join(root, '.test-noah-home', 'state.json'), 'utf8'), { code: 'ENOENT' });
  });
});

test('rejects extra positional arguments', async () => {
  await withTemporaryProject(async (root) => {
    const extra = runCli(root, 'language', 'vi', 'en');
    assert.equal(extra.status, 2);
    assert.match(extra.stderr, /Unexpected argument: en/);

    const unexpected = runCli(root, 'status', 'now');
    assert.equal(unexpected.status, 2);
    assert.match(unexpected.stderr, /Unexpected argument: now/);
  });
});

test('the generated Claude Code rule applies the local communication language', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const instructions = await readFile(path.join(root, '.claude', 'rules', 'noah-kit.md'), 'utf8');
    assert.match(instructions, /preferences\.communication_language/);
    assert.match(instructions, /Code, identifiers, code comments, tests, configuration keys, and technical documentation MUST be in English/);
  });
});

test('installs a new Core version beside an existing older one and dispatches to the newest', async () => {
  await withTemporaryProject(async (root) => {
    const home = path.join(root, '.test-noah-home');
    const oldPath = path.join(home, 'versions', '0.1.0');
    await mkdir(path.join(oldPath, 'src'), { recursive: true });
    const oldCli = 'export async function run() { process.stdout.write("old core\\n"); return 0; }\n';
    await writeFile(path.join(oldPath, 'src', 'cli.js'), oldCli);
    await writeFile(path.join(oldPath, 'core-manifest.json'), JSON.stringify({ schema_version: 1, package_name: 'noah-kit', version: '0.1.0' }));
    await writeFile(path.join(home, 'state.json'), JSON.stringify({
      schema_version: 1,
      installations: { '0.1.0': { version: '0.1.0', path: oldPath } },
      projects: {}
    }));

    const install = runCli(root, 'install');
    assert.equal(install.status, 0, install.stderr);
    assert.equal(runCli(root, 'link').status, 0);

    const state = JSON.parse(await readFile(path.join(home, 'state.json'), 'utf8'));
    assert.deepEqual(Object.keys(state.installations).sort(), ['0.1.0', CORE_VERSION].sort());
    assert.equal(await readFile(path.join(oldPath, 'src', 'cli.js'), 'utf8'), oldCli);

    const dispatched = spawnSync(process.execPath, [path.join(home, 'bin', 'noah.js'), '--version'], {
      encoding: 'utf8',
      env: { ...process.env, NOAH_HOME: home }
    });
    assert.equal(dispatched.status, 0, dispatched.stderr);
    assert.equal(dispatched.stdout.trim(), CORE_VERSION);
  });
});

test('importing src/cli.js has no side effects', () => {
  const modulePath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(modulePath).href)});`, '--', '--version'], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('runs when invoked through a symlinked directory', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Directory symlinks need elevated rights on Windows.');
    return;
  }
  await withTemporaryProject(async (root) => {
    const linkedSource = path.join(root, 'linked-src');
    await symlink(path.dirname(cliPath), linkedSource, 'dir');

    const result = spawnSync(process.execPath, [path.join(linkedSource, 'main.js'), '--version'], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), CORE_VERSION);
  });
});

test('runs through a file symlink to the entry, as an npm bin link does', async (t) => {
  if (process.platform === 'win32') {
    t.skip('File symlinks need elevated rights on Windows.');
    return;
  }
  await withTemporaryProject(async (root) => {
    const binLink = path.join(root, 'noah');
    await symlink(cliPath, binLink, 'file');

    const result = spawnSync(binLink, ['--version'], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.equal(result.stdout.trim(), CORE_VERSION);
  });
});
