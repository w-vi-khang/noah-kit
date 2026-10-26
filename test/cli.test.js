import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PERMISSION_RULES } from '../src/claude-permissions.js';

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
    assert.ok(await readFile(path.join(installPath, 'skills', 'workflow-orchestration', 'SKILL.md'), 'utf8'));
    assert.ok(await readFile(path.join(installPath, 'scripts', 'stop-gate.js'), 'utf8'));
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

function ruleSection(instructions, heading) {
  return instructions.split(`\n${heading}\n`)[1]?.split('\n## ')[0] ?? '';
}

test('the generated rule has each new section exactly once, before the Core installation check', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const instructions = await readFile(path.join(root, '.claude', 'rules', 'noah-kit.md'), 'utf8');
    const count = (heading) => instructions.split('\n').filter((line) => line === heading).length;
    assert.equal(count('## Changing instructions, hooks, and permissions'), 1);
    assert.equal(count('## Deterministic steps'), 1);
    assert.equal(count('## Correcting mistakes'), 1);
    assert.equal(count('## Reviewing after a new requirement'), 1);
    assert.equal(count('## Core installation check'), 1);
    const changing = instructions.indexOf('\n## Changing instructions, hooks, and permissions\n');
    const deterministic = instructions.indexOf('\n## Deterministic steps\n');
    const correcting = instructions.indexOf('\n## Correcting mistakes\n');
    const reviewing = instructions.indexOf('\n## Reviewing after a new requirement\n');
    const core = instructions.indexOf('\n## Core installation check\n');
    assert.ok(changing >= 0 && changing < deterministic, 'Changing instructions must precede Deterministic steps');
    assert.ok(changing >= 0 && changing < correcting, 'Changing instructions must precede Correcting mistakes');
    assert.ok(deterministic >= 0 && deterministic < correcting, 'Deterministic steps must precede Correcting mistakes');
    assert.ok(correcting >= 0 && correcting < core, 'Correcting mistakes must precede Core installation check');
    assert.ok(reviewing >= 0 && reviewing < core, 'Reviewing section must precede Core installation check');
  });
});

async function generatedSection(heading) {
  let section = '';
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'init').status, 0);
    const instructions = await readFile(path.join(root, '.claude', 'rules', 'noah-kit.md'), 'utf8');
    section = ruleSection(instructions, heading);
  });
  assert.notEqual(section, '', `${heading} section must exist`);
  return section;
}

test('the generated rule defines a mistake as reported work, excluding a check fixed before reporting', async () => {
  const section = await generatedSection('## Correcting mistakes');
  assert.match(section, /A mistake is a result of the agent's work, including work it delegated, that contradicts the user's request, an instruction, an acceptance criterion, or a verifiable fact/);
  assert.match(section, /after the agent reported that result to the user as done or as fact\./);
  assert.match(section, /The steps below apply whether the agent, the user, or a reviewer finds the mistake\./);
  assert.match(section, /A failing check or a review finding on work not yet reported as done is not a mistake; the project's change process handles it\./);
});

test('the generated rule requires root cause, a search for and fix of every instance, and a prevention measure', async () => {
  const section = await generatedSection('## Correcting mistakes');
  assert.match(section, /1\. MUST identify the root cause/);
  assert.match(section, /2\. MUST search the files changed in the current session, and other files that contain the same pattern \(for example, with `git grep`\), for other instances of the same mistake\. MUST fix every instance found\./);
  assert.match(section, /3\. MUST add or strengthen a prevention measure/);
  assert.match(section, /MUST NOT add a duplicate/);
  assert.match(section, /MUST NOT keep a prevention measure only in the agent's local memory/);
});

test('the generated rule requires approval and a safety contract for reusable hooks', async () => {
  const section = await generatedSection('## Correcting mistakes');
  assert.match(section, /MUST NOT add an ad hoc Claude Code hook or Git hook as a prevention measure without explicit user approval and a tested failure\/loop contract\./);
  assert.match(section, /Reusable Noah Kit plugin hooks are governed by the approved Core change and hook-specific tests\./);
});

test('the generated rule requires finishing the correction before reporting the task and honors change-process limits', async () => {
  const section = await generatedSection('## Correcting mistakes');
  assert.match(section, /MUST finish steps 1 to 5 before reporting the original task as done\./);
  assert.match(section, /MUST follow the project's change process and its limits, including the tiers and fix-round bounds in `\.claude\/rules\/main-agent\.md` where that file exists\./);
  assert.match(section, /A change process is a written procedure for making and verifying changes, such as stages, review, or verification steps, in `CLAUDE\.md`, `CONTRIBUTING\.md`, or a file in `\.claude\/rules\/` other than this one\. If the project has none, MUST ask the user before applying a prevention measure\./);
  assert.match(section, /A measure that changes an instruction file or a permission setting MUST follow "Changing instructions, hooks, and permissions"\. If the user has not approved it, MUST report it as proposed, not as applied\./);
  assert.match(section, /\n- MUST report to the user every instance and every prevention measure left unapplied because of those limits\./);
});

test('the generated rule places the prevention measure by project and requires a report', async () => {
  const section = await generatedSection('## Correcting mistakes');
  assert.match(section, /In the Noah Kit source repository \(its root `package\.json` has `name` `noah-kit`\), MUST apply it in that repository\./);
  assert.match(section, /In another project, MUST apply the part of the measure that changes only the project's own files in that project\./);
  assert.match(section, /In another project, MUST NOT edit Noah Kit files: this rule file and the Core installation directory\./);
  assert.match(section, /If the measure needs a change to them or to the manifest format, MUST warn the user and describe the mistake, its root cause, and the proposed change/);
  assert.match(section, /5\. MUST report to the user: the mistake, its root cause, the instances fixed, and the prevention measure applied or proposed\./);
});

test('the generated rule limits a subagent to its editable files and makes the delegating agent finish the correction', async () => {
  const section = await generatedSection('## Correcting mistakes');
  assert.match(section, /A subagent MAY read any file for step 2\./);
  assert.match(section, /It MUST edit only the files its task allows\./);
  assert.match(section, /It MUST report the root cause, the instances it could not fix, and the proposed prevention measure to the agent that delegated the task\./);
  assert.match(section, /That agent MUST complete the remaining work in steps 2 to 5\./);
});

test('the generated rule requires approval before changing instructions, hooks, and permissions', async () => {
  const section = await generatedSection('## Changing instructions, hooks, and permissions');
  assert.match(section, /Instruction files are `CLAUDE\.md`, files in `\.claude\/rules\/`, agent definitions in `\.claude\/agents\/`, and skills\./);
  assert.match(section, /Permission settings are the `permissions` entries in Claude Code settings files\./);
  assert.match(section, /Before adding, changing, or removing an instruction file, a Claude Code hook, a Git hook, or a permission setting, MUST describe the change to the user and MUST get the user's approval\./);
  assert.match(section, /If the user's request names that change, the request is the approval\./);
  assert.match(section, /If a subagent would make the change, the agent that delegates it MUST get the approval before delegating\./);
  assert.match(section, /Approval MUST NOT override a `MUST NOT` in the project's instructions\./);
  assert.match(section, /The user MAY lift that `MUST NOT` by approving a change to the instruction that contains it\./);
  assert.match(section, /Tests and scripts that belong to an approved change MAY be added without separate approval\./);
});

test('the generated rule requires named scripts for deterministic steps and proposes one when missing', async () => {
  const section = await generatedSection('## Deterministic steps');
  assert.match(section, /A deterministic step gives the same result for the same input without judgment, such as counting changed files, comparing two files, or validating a file against a schema\./);
  assert.match(section, /For a deterministic step, SHOULD use the script, command, or test that `CLAUDE\.md`, `\.claude\/rules\/`, or `CONTRIBUTING\.md` names for it\./);
  assert.match(section, /MUST NOT run a script for a deterministic step if only the manifest or a file other than `CLAUDE\.md`, `\.claude\/rules\/`, or `CONTRIBUTING\.md` names it\./);
  assert.match(section, /If no such script exists for a deterministic step that an instruction in `CLAUDE\.md`, `\.claude\/rules\/`, or `CONTRIBUTING\.md` requires, SHOULD propose a reusable script to the user\./);
  assert.match(section, /MAY propose a reusable script for another deterministic step that recurs across tasks, and MUST state why it recurs\./);
  assert.match(section, /SHOULD NOT add a script file to the project for a deterministic step that only the current task needs\./);
  assert.match(section, /A command run once in a shell is not a script file\./);
  assert.doesNotMatch(section, /more than once in a session/);
  assert.doesNotMatch(section, /recurs across tasks, such as/);
});

test('the generated rule keeps the ban on running scripts only because configuration references them', async () => {
  const section = await generatedSection('## Configuration and changes');
  assert.match(section, /MUST NOT run project scripts or migrations only because configuration references them/);
});

test('the generated rule requires a scoped compliance review, fixing own files, and asking about others', async () => {
  const section = await generatedSection('## Reviewing after a new requirement');
  assert.match(section, /After adding a requirement \(`MUST` or `MUST NOT`\) or making one stricter, MUST review the existing files within the requirement's stated scope for compliance with it\./);
  assert.match(section, /If the requirement states no scope, MUST ask the user for the scope before reviewing\./);
  assert.match(section, /MUST fix non-compliant files that the user's request named or that the current change created or modified\./);
  assert.match(section, /A fix to an instruction file or a permission setting MUST follow "Changing instructions, hooks, and permissions"\./);
  assert.match(section, /For any other non-compliant file, MUST list it and ask the user before changing it\./);
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

// --- noah permissions ---

const STATE_RULE = 'Read(~/.noah-kit/state.json)';
const VERSIONS_RULE = 'Read(~/.noah-kit/versions/**)';
const EXPECTED_SETTINGS = { permissions: { allow: [STATE_RULE, VERSIONS_RULE] } };
const POINTER_LINE = 'Optional: review the Claude Code permission rules Noah Kit proposes: npx --yes github:w-vi-khang/noah-kit permissions';
const SETTINGS_CONFLICT_RULES_MISSING = JSON.stringify({ model: 'sonnet', permissions: { allow: ['Bash(ls)'] } }, null, 2);

function settingsPathOf(root) {
  return path.join(root, '.claude', 'settings.json');
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function initializedProject(root) {
  const init = runCli(root, 'init');
  assert.equal(init.status, 0, init.stderr);
}

async function assertNoNoahHome(root) {
  assert.equal(await pathExists(path.join(root, '.test-noah-home')), false, 'permissions must not create NOAH_HOME');
}

async function snapshotProtectedFiles(root) {
  return {
    manifest: await readFile(path.join(root, '.noah-kit', 'manifest.json'), 'utf8'),
    rule: await readFile(path.join(root, '.claude', 'rules', 'noah-kit.md'), 'utf8')
  };
}

async function trySymlink(t, target, linkPath, type = 'file') {
  try {
    await symlink(target, linkPath, type);
    return true;
  } catch (error) {
    if (error.code === 'EPERM' || process.platform === 'win32') {
      t.skip(`Symbolic links (${type}) are not permitted here: ${error.code}`);
      return false;
    }
    throw error;
  }
}

const EXPECTED_SETTINGS_TEXT = `${JSON.stringify(EXPECTED_SETTINGS, null, 2)}\n`;
const TRUST_NOTE = 'Claude Code applies permissions.allow rules from project settings only after the workspace trust dialog is accepted; claude -p and SDK sessions in a folder that was never trusted do not apply them.';
const PRECEDENCE_NOTE = 'Deny and ask rules, and managed settings, take precedence over these rules.';
const VISIBILITY_NOTE = 'This command cannot see user settings or managed settings.';
const ALREADY_PRESENT_LINE = 'ALREADY_PRESENT: .claude/settings.json already lists every proposed rule in permissions.allow.\n';
const EXISTING_FILE_LINE = 'CONFLICT_EXISTING_FILE: .claude/settings.json exists and does not list every proposed rule in permissions.allow.\n';
const CLAUDE_SYMLINK_DETAIL = '.claude is a symbolic link; Noah Kit does not follow it.';
const SETTINGS_SYMLINK_DETAIL = '.claude/settings.json is a symbolic link; Noah Kit does not follow it.';
const MISSING_HEADING = 'Missing from permissions.allow:\n';

// Every CONFLICT_* output (preview and --apply error) lists every proposed
// rule with its reason, and the full settings JSON.
function assertListsEveryRuleAndTheJson(text, label) {
  assert.ok(text.includes('Proposed rules:\n'), `${label}: has the proposed rules heading\n${text}`);
  for (const entry of PERMISSION_RULES) {
    assert.ok(entry.reason.length > 0);
    assert.ok(text.includes(`  - ${entry.rule}\n    Reason: ${entry.reason}\n`), `${label}: lists ${entry.rule} with its reason\n${text}`);
  }
  assert.ok(text.includes(EXPECTED_SETTINGS_TEXT), `${label}: prints the full settings JSON\n${text}`);
}

// The text under "Missing from permissions.allow:", up to the proposed rules,
// or null when the heading is absent.
function missingSection(text) {
  const start = text.indexOf(MISSING_HEADING);
  if (start === -1) return null;
  assert.equal(text.indexOf(MISSING_HEADING, start + 1), -1, 'the missing rules heading appears once');
  const rest = text.slice(start + MISSING_HEADING.length);
  const end = rest.indexOf('Proposed rules:\n');
  assert.notEqual(end, -1, 'the proposed rules follow the missing rules');
  return rest.slice(0, end);
}

// Preview exits 0 with the detail; --apply exits 1, prints nothing to stdout,
// and ends with "Nothing was changed."; both list every rule and the JSON.
function assertInvalidFileRefused(root, detail, label) {
  const preview = runCli(root, 'permissions');
  assert.equal(preview.status, 0, `${label} preview: ${preview.stderr}`);
  assert.ok(preview.stdout.startsWith(`CONFLICT_INVALID_FILE: ${detail}\nTarget: ${settingsPathOf(root)}\n`), `${label} preview:\n${preview.stdout}`);
  assertListsEveryRuleAndTheJson(preview.stdout, `${label} preview`);
  assert.equal(missingSection(preview.stdout), null, `${label} preview has no missing rules list`);
  assert.ok(preview.stdout.endsWith('Preview only. Nothing was written.\n'), `${label} preview`);

  const apply = runCli(root, 'permissions', '--apply');
  assert.equal(apply.status, 1, `${label} --apply: ${apply.stdout}`);
  assert.equal(apply.stdout, '', `${label} --apply writes nothing to stdout`);
  assert.ok(apply.stderr.includes(`CONFLICT_INVALID_FILE: ${detail}\nTarget: ${settingsPathOf(root)}\n`), `${label} --apply:\n${apply.stderr}`);
  assertListsEveryRuleAndTheJson(apply.stderr, `${label} --apply`);
  assert.equal(missingSection(apply.stderr), null, `${label} --apply has no missing rules list`);
  assert.match(apply.stderr, /Nothing was changed\.\n$/, label);
  assert.doesNotMatch(apply.stderr, /Unexpected error/, label);
  return { preview, apply };
}

test('permissions preview after init prints WILL_CREATE, both rules and reasons, and writes nothing', async () => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const before = await snapshotProtectedFiles(root);

    const result = runCli(root, 'permissions');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^WILL_CREATE: /m);
    for (const entry of PERMISSION_RULES) {
      assert.ok(result.stdout.includes(entry.rule), `preview lists ${entry.rule}`);
      assert.ok(result.stdout.includes(entry.reason), `preview lists the reason for ${entry.rule}`);
    }
    assert.ok(result.stdout.includes(STATE_RULE) && result.stdout.includes(VERSIONS_RULE));
    assert.ok(result.stdout.includes(`${JSON.stringify(EXPECTED_SETTINGS, null, 2)}\n`), 'preview prints the exact JSON');
    assert.match(result.stdout, /workspace trust/i);
    assert.match(result.stdout, /managed settings/i);
    assert.ok(result.stdout.includes(`  - ${TRUST_NOTE}\n`), `preview prints the exact trust note\n${result.stdout}`);
    assert.ok(result.stdout.includes(`  - ${PRECEDENCE_NOTE}\n`), 'preview prints the exact precedence note');
    assert.ok(result.stdout.includes(`  - ${VISIBILITY_NOTE}\n`), 'preview says it cannot see user or managed settings');
    assert.ok(result.stdout.endsWith('Preview only. Nothing was written.\n'));
    assert.equal(await pathExists(settingsPathOf(root)), false);
    assert.equal(await pathExists(path.join(root, '.claude', 'settings.local.json')), false);
    assert.deepEqual(await snapshotProtectedFiles(root), before);
    await assertNoNoahHome(root);
  });
});

test('permissions --apply creates exactly the approved settings and a repeat reports ALREADY_PRESENT with identical bytes', async () => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const before = await snapshotProtectedFiles(root);

    const first = runCli(root, 'permissions', '--apply');

    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /^CREATED: /m);
    const bytes = await readFile(settingsPathOf(root), 'utf8');
    assert.deepEqual(JSON.parse(bytes), EXPECTED_SETTINGS);
    assert.deepEqual(Object.keys(JSON.parse(bytes)), ['permissions']);
    assert.deepEqual(Object.keys(JSON.parse(bytes).permissions), ['allow']);
    assert.ok(bytes.endsWith('\n'));
    assert.equal(bytes, EXPECTED_SETTINGS_TEXT, 'the file holds exactly the previewed JSON');
    assert.ok(first.stdout.includes(`Exact content written:\n${EXPECTED_SETTINGS_TEXT}`), first.stdout);

    const second = runCli(root, 'permissions', '--apply');

    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, `${ALREADY_PRESENT_LINE}Target: ${settingsPathOf(root)}\n${PRECEDENCE_NOTE}\nNothing was written.\n`);
    assert.doesNotMatch(second.stdout, /CREATED/);
    assert.equal(await readFile(settingsPathOf(root), 'utf8'), bytes);

    const preview = runCli(root, 'permissions');
    assert.equal(preview.status, 0, preview.stderr);
    assert.ok(preview.stdout.startsWith(ALREADY_PRESENT_LINE), preview.stdout);
    assert.ok(preview.stdout.includes(`  - ${PRECEDENCE_NOTE}\n`), 'the ALREADY_PRESENT preview keeps the precedence note');
    assert.ok(preview.stdout.endsWith('Nothing needs to change. Nothing was written.\n'));
    assert.equal(await readFile(settingsPathOf(root), 'utf8'), bytes);

    assert.deepEqual(await snapshotProtectedFiles(root), before);
    assert.equal(await pathExists(path.join(root, '.claude', 'settings.local.json')), false);
    await assertNoNoahHome(root);
  });
});

test('permissions --apply creates .claude when only the manifest exists and leaves no stray files', async () => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    await rm(path.join(root, '.claude'), { recursive: true });

    const result = runCli(root, 'permissions', '--apply');

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readdir(path.join(root, '.claude')), ['settings.json']);
    assert.deepEqual(JSON.parse(await readFile(settingsPathOf(root), 'utf8')), EXPECTED_SETTINGS);
  });
});

test('permissions treats a file that already has every rule as ALREADY_PRESENT without touching extra user keys', async () => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const original = `${JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(ls)', STATE_RULE, VERSIONS_RULE], deny: ['Read(.env)'] } })}\n`;
    await writeFile(settingsPathOf(root), original);

    for (const args of [['permissions'], ['permissions', '--apply']]) {
      const result = runCli(root, ...args);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.startsWith(`${ALREADY_PRESENT_LINE}Target: ${settingsPathOf(root)}\n`), result.stdout);
      assert.ok(result.stdout.includes(PRECEDENCE_NOTE), `${args.join(' ')} prints the precedence note`);
      assert.equal(missingSection(result.stdout), null);
      assert.equal(await readFile(settingsPathOf(root), 'utf8'), original);
    }
    await assertNoNoahHome(root);
  });
});

test('permissions preview of an existing file without the rules reports CONFLICT_EXISTING_FILE, lists only the missing rules under their heading, lists every rule and the JSON, and exits 0', async () => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const cases = [
      { content: SETTINGS_CONFLICT_RULES_MISSING, missing: [STATE_RULE, VERSIONS_RULE] },
      { content: '{}', missing: [STATE_RULE, VERSIONS_RULE] },
      { content: JSON.stringify({ permissions: { allow: [STATE_RULE] } }), missing: [VERSIONS_RULE] },
      { content: JSON.stringify({ permissions: { allow: [VERSIONS_RULE] } }), missing: [STATE_RULE] }
    ];
    for (const { content, missing } of cases) {
      await writeFile(settingsPathOf(root), content);

      const result = runCli(root, 'permissions');

      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.startsWith(`${EXISTING_FILE_LINE}Target: ${settingsPathOf(root)}\n${MISSING_HEADING}`), `case ${content}:\n${result.stdout}`);
      assert.equal(missingSection(result.stdout), missing.map((rule) => `  - ${rule}\n`).join(''), `only the missing rules are listed as missing (case ${content})`);
      assertListsEveryRuleAndTheJson(result.stdout, `preview ${content}`);
      assert.match(result.stdout, /\/permissions/);
      assert.ok(result.stdout.endsWith('Preview only. Nothing was written.\n'));
      assert.equal(await readFile(settingsPathOf(root), 'utf8'), content);
    }
    await assertNoNoahHome(root);
  });
});

test('permissions --apply on an existing file without the rules exits 1, lists the missing rules, every rule and the JSON, says nothing changed, and keeps the bytes', async () => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const before = await snapshotProtectedFiles(root);
    const cases = [
      { content: SETTINGS_CONFLICT_RULES_MISSING, missing: [STATE_RULE, VERSIONS_RULE] },
      { content: '{}', missing: [STATE_RULE, VERSIONS_RULE] },
      { content: JSON.stringify({ permissions: { allow: [STATE_RULE] } }), missing: [VERSIONS_RULE] },
      { content: '', missing: null }
    ];
    for (const { content, missing } of cases) {
      await writeFile(settingsPathOf(root), content);

      const result = runCli(root, 'permissions', '--apply');

      assert.equal(result.status, 1, `case ${JSON.stringify(content)}: ${result.stdout}`);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Nothing was changed\.\n$/);
      assert.doesNotMatch(result.stderr, /Unexpected error/);
      if (missing) {
        assert.ok(result.stderr.includes(`${EXISTING_FILE_LINE}Target: ${settingsPathOf(root)}\n`), result.stderr);
        assert.equal(missingSection(result.stderr), missing.map((rule) => `  - ${rule}\n`).join(''), `case ${content}`);
      } else {
        assert.match(result.stderr, /CONFLICT_INVALID_FILE: \.claude\/settings\.json is not valid JSON\.\n/);
        assert.equal(missingSection(result.stderr), null);
      }
      assertListsEveryRuleAndTheJson(result.stderr, `--apply ${JSON.stringify(content)}`);
      assert.equal(await readFile(settingsPathOf(root), 'utf8'), content);
    }
    assert.deepEqual(await snapshotProtectedFiles(root), before);
    await assertNoNoahHome(root);
  });
});

test('permissions refuses invalid or unusable settings content: preview CONFLICT_INVALID_FILE with every rule and the JSON, --apply exit 1, bytes unchanged', async () => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const notJson = '.claude/settings.json is not valid JSON.';
    const notObject = '.claude/settings.json must contain a JSON object.';
    const badPermissions = 'The "permissions" value must be a JSON object.';
    const badAllow = 'The "permissions.allow" value must be an array.';
    const invalidContents = [
      ['{ invalid json', notJson],
      ['', notJson],
      ['[]', notObject],
      ['null', notObject],
      ['"text"', notObject],
      [JSON.stringify({ permissions: [] }), badPermissions],
      [JSON.stringify({ permissions: null }), badPermissions],
      [JSON.stringify({ permissions: 'allow' }), badPermissions],
      [JSON.stringify({ permissions: { allow: 'Read(~/.noah-kit/state.json)' } }), badAllow],
      [JSON.stringify({ permissions: { allow: {} } }), badAllow]
    ];
    for (const [content, detail] of invalidContents) {
      await writeFile(settingsPathOf(root), content);

      const { preview } = assertInvalidFileRefused(root, detail, JSON.stringify(content));

      assert.doesNotMatch(preview.stdout, /^WILL_CREATE|^ALREADY_PRESENT/m);
      assert.equal(await readFile(settingsPathOf(root), 'utf8'), content);
    }
    await assertNoNoahHome(root);
  });
});

test('permissions refuses when the settings path is a directory and leaves it intact', async () => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    await mkdir(settingsPathOf(root), { recursive: true });
    await writeFile(path.join(settingsPathOf(root), 'keep.txt'), 'keep this file');

    assertInvalidFileRefused(root, '.claude/settings.json is not a regular file.', 'directory');

    assert.equal((await lstat(settingsPathOf(root))).isDirectory(), true);
    assert.deepEqual(await readdir(settingsPathOf(root)), ['keep.txt']);
    assert.equal(await readFile(path.join(settingsPathOf(root), 'keep.txt'), 'utf8'), 'keep this file');
  });
});

test('permissions refuses a symlink to a file, even one that holds every rule, and leaves link and target untouched', async (t) => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const cases = [
      { name: 'without-rules.json', content: SETTINGS_CONFLICT_RULES_MISSING },
      { name: 'with-rules.json', content: `${JSON.stringify(EXPECTED_SETTINGS, null, 2)}\n` }
    ];
    for (const { name, content } of cases) {
      const targetFile = path.join(root, name);
      await writeFile(targetFile, content);
      await rm(settingsPathOf(root), { force: true });
      if (!(await trySymlink(t, targetFile, settingsPathOf(root)))) return;

      const { preview, apply } = assertInvalidFileRefused(root, SETTINGS_SYMLINK_DETAIL, name);

      assert.match(preview.stdout, /symbolic link/, name);
      assert.match(apply.stderr, /symbolic link/, name);
      assert.doesNotMatch(preview.stdout, /^ALREADY_PRESENT/m, name);
      assert.doesNotMatch(apply.stdout, /ALREADY_PRESENT|CREATED/);
      assert.equal((await lstat(settingsPathOf(root))).isSymbolicLink(), true, name);
      assert.equal(await readlink(settingsPathOf(root)), targetFile);
      assert.equal(await readFile(targetFile, 'utf8'), content);
    }
    await assertNoNoahHome(root);
  });
});

test('permissions refuses a dangling symlink and does not create its target', async (t) => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const missingTarget = path.join(root, 'outside', 'target-settings.json');
    if (!(await trySymlink(t, missingTarget, settingsPathOf(root)))) return;

    const { preview, apply } = assertInvalidFileRefused(root, SETTINGS_SYMLINK_DETAIL, 'dangling settings.json link');

    assert.match(preview.stdout, /symbolic link/);
    assert.match(apply.stderr, /symbolic link/);
    assert.doesNotMatch(preview.stdout, /^WILL_CREATE/m);
    assert.equal(await pathExists(missingTarget), false, 'the link target must not be created');
    assert.equal(await pathExists(path.dirname(missingTarget)), false, 'the link target directory must not be created');
    assert.equal((await lstat(settingsPathOf(root))).isSymbolicLink(), true);
    assert.equal(await readlink(settingsPathOf(root)), missingTarget);
  });
});

test('permissions refuses .claude as a symbolic link to a directory and creates nothing in the target directory', async (t) => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const claudePath = path.join(root, '.claude');
    const sharedDirectory = path.join(root, 'shared-claude');
    await mkdir(path.join(sharedDirectory, 'rules'), { recursive: true });
    await writeFile(path.join(sharedDirectory, 'rules', 'noah-kit.md'), await readFile(path.join(claudePath, 'rules', 'noah-kit.md'), 'utf8'));
    await writeFile(path.join(sharedDirectory, 'keep.txt'), 'keep this file');
    await rm(claudePath, { recursive: true });
    if (!(await trySymlink(t, sharedDirectory, claudePath, 'dir'))) return;
    const targetBefore = (await readdir(sharedDirectory, { recursive: true })).sort();
    const rootBefore = (await readdir(root)).sort();

    assertInvalidFileRefused(root, CLAUDE_SYMLINK_DETAIL, '.claude link to a directory');

    assert.equal(await pathExists(path.join(sharedDirectory, 'settings.json')), false, 'no settings.json in the link target');
    assert.deepEqual((await readdir(sharedDirectory, { recursive: true })).sort(), targetBefore);
    assert.equal(await readFile(path.join(sharedDirectory, 'keep.txt'), 'utf8'), 'keep this file');
    assert.equal((await lstat(claudePath)).isSymbolicLink(), true);
    assert.equal(await readlink(claudePath), sharedDirectory);
    assert.deepEqual((await readdir(root)).sort(), rootBefore);
    await assertNoNoahHome(root);
  });
});

test('permissions refuses .claude as a dangling symbolic link and does not create its target', async (t) => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const claudePath = path.join(root, '.claude');
    const missingDirectory = path.join(root, 'missing-claude');
    await rm(claudePath, { recursive: true });
    if (!(await trySymlink(t, missingDirectory, claudePath, 'dir'))) return;
    const rootBefore = (await readdir(root)).sort();

    assertInvalidFileRefused(root, CLAUDE_SYMLINK_DETAIL, 'dangling .claude link');

    assert.equal(await pathExists(missingDirectory), false, 'the link target must not be created');
    assert.equal((await lstat(claudePath)).isSymbolicLink(), true);
    assert.equal(await readlink(claudePath), missingDirectory);
    assert.deepEqual((await readdir(root)).sort(), rootBefore);
    await assertNoNoahHome(root);
  });
});

test('permissions refuses .claude as a symbolic link loop and leaves both links unchanged', async (t) => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const claudePath = path.join(root, '.claude');
    const otherLink = path.join(root, 'claude-loop');
    await rm(claudePath, { recursive: true });
    if (!(await trySymlink(t, otherLink, claudePath, 'dir'))) return;
    if (!(await trySymlink(t, claudePath, otherLink, 'dir'))) return;
    const rootBefore = (await readdir(root)).sort();

    assertInvalidFileRefused(root, CLAUDE_SYMLINK_DETAIL, '.claude link loop');

    assert.equal((await lstat(claudePath)).isSymbolicLink(), true);
    assert.equal((await lstat(otherLink)).isSymbolicLink(), true);
    assert.equal(await readlink(claudePath), otherLink);
    assert.equal(await readlink(otherLink), claudePath);
    assert.deepEqual((await readdir(root)).sort(), rootBefore);
    await assertNoNoahHome(root);
  });
});

test('permissions with .claude as a regular file exits 1 without an unexpected error and keeps the file', async () => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    await rm(path.join(root, '.claude'), { recursive: true });
    await writeFile(path.join(root, '.claude'), 'not a directory');

    assertInvalidFileRefused(root, '.claude exists but is not a directory.', '.claude regular file');

    assert.equal((await lstat(path.join(root, '.claude'))).isFile(), true);
    assert.equal(await readFile(path.join(root, '.claude'), 'utf8'), 'not a directory');
    await assertNoNoahHome(root);
  });
});

test('permissions without a manifest exits 1 for preview and --apply and creates no .claude directory', async () => {
  await withTemporaryProject(async (root) => {
    for (const args of [['permissions'], ['permissions', '--apply']]) {
      const result = runCli(root, ...args);

      assert.equal(result.status, 1, args.join(' '));
      assert.match(result.stderr, /Initialize the project first/);
      assert.equal(result.stdout, '');
      assert.equal(await pathExists(path.join(root, '.claude')), false);
      assert.equal(await pathExists(path.join(root, '.noah-kit')), false);
    }
    await assertNoNoahHome(root);
  });
});

test('permissions with an invalid manifest exits 1 for preview and --apply with the manifest validation error, creates nothing, and keeps the manifest', async () => {
  await withTemporaryProject(async (root) => {
    const manifestPath = path.join(root, '.noah-kit', 'manifest.json');
    await mkdir(path.dirname(manifestPath), { recursive: true });
    const cases = [
      ['{ invalid json', '.noah-kit/manifest.json is not valid JSON.'],
      ['[]', '.noah-kit/manifest.json: The Noah Kit manifest must contain a JSON object.'],
      [JSON.stringify({ schema_version: 1 }), '.noah-kit/manifest.json: The manifest kit.id must be "noah-kit".']
    ];
    for (const [content, validationError] of cases) {
      await writeFile(manifestPath, content);
      for (const args of [['permissions'], ['permissions', '--apply']]) {
        const result = runCli(root, ...args);

        assert.equal(result.status, 1, `${args.join(' ')} with ${content}: ${result.stdout}`);
        assert.match(result.stderr, /manifest/i, `${args.join(' ')} with ${content}`);
        assert.equal(result.stderr, `Noah Kit permissions failed: ${validationError}\n`);
        assert.doesNotMatch(result.stderr, /Unexpected error/);
        assert.equal(result.stdout, '');
        assert.equal(await pathExists(path.join(root, '.claude')), false);
        assert.equal(await readFile(manifestPath, 'utf8'), content);
      }
    }
    await assertNoNoahHome(root);
  });
});

test('permissions with a manifest that lacks schema_version exits 1 with an error that names the manifest', async () => {
  await withTemporaryProject(async (root) => {
    const manifestPath = path.join(root, '.noah-kit', 'manifest.json');
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, '{}');
    for (const args of [['permissions'], ['permissions', '--apply']]) {
      const result = runCli(root, ...args);

      assert.equal(result.status, 1, `${args.join(' ')}: ${result.stdout}`);
      assert.equal(result.stdout, '');
      assert.equal(await pathExists(path.join(root, '.claude')), false);
      assert.equal(await readFile(manifestPath, 'utf8'), '{}');
      assert.match(result.stderr, /manifest/i, `${args.join(' ')}: the error must name the manifest, got: ${result.stderr}`);
    }
  });
});

test('permissions never parses or changes settings.local.json, the manifest, the generated rule, or NOAH_HOME', async () => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const before = await snapshotProtectedFiles(root);
    const localSettingsPath = path.join(root, '.claude', 'settings.local.json');
    const localContent = '{ this is not valid json and must never be parsed';
    await writeFile(localSettingsPath, localContent);

    const preview = runCli(root, 'permissions');
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /^WILL_CREATE: /m);
    const apply = runCli(root, 'permissions', '--apply');
    assert.equal(apply.status, 0, apply.stderr);
    const repeat = runCli(root, 'permissions', '--apply');
    assert.equal(repeat.status, 0, repeat.stderr);

    assert.equal(await readFile(localSettingsPath, 'utf8'), localContent);
    assert.deepEqual(await snapshotProtectedFiles(root), before);
    assert.deepEqual((await readdir(path.join(root, '.claude'))).sort(), ['rules', 'settings.json', 'settings.local.json']);
    await assertNoNoahHome(root);
  });
});

test('permissions does not read settings.local.json: an unreadable one changes neither the outcome nor the file', async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX file modes are required.');
    return;
  }
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const localSettingsPath = path.join(root, '.claude', 'settings.local.json');
    const localContent = '{ "permissions": { "allow": [] } }\n';
    await writeFile(localSettingsPath, localContent);
    await chmod(localSettingsPath, 0o000);
    try {
      try {
        await readFile(localSettingsPath, 'utf8');
        t.skip('This user can read a file with mode 000.');
        return;
      } catch (error) {
        if (error.code !== 'EACCES') throw error;
      }

      const preview = runCli(root, 'permissions');
      assert.equal(preview.status, 0, preview.stderr);
      assert.match(preview.stdout, /^WILL_CREATE: /m);
      const apply = runCli(root, 'permissions', '--apply');
      assert.equal(apply.status, 0, apply.stderr);
      assert.match(apply.stdout, /^CREATED: /m);
      const repeat = runCli(root, 'permissions', '--apply');
      assert.equal(repeat.status, 0, repeat.stderr);
      assert.ok(repeat.stdout.startsWith(ALREADY_PRESENT_LINE), repeat.stdout);
      assert.equal((await lstat(localSettingsPath)).mode & 0o777, 0, 'the mode is unchanged');
    } finally {
      await chmod(localSettingsPath, 0o600);
    }
    assert.equal(await readFile(localSettingsPath, 'utf8'), localContent);
  });
});

test('permissions does not touch an existing NOAH_HOME or its state', async () => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    assert.equal(runCli(root, 'install').status, 0);
    const home = path.join(root, '.test-noah-home');
    const stateBefore = await readFile(path.join(home, 'state.json'), 'utf8');
    const entriesBefore = (await readdir(home, { recursive: true })).sort();

    assert.equal(runCli(root, 'permissions').status, 0);
    assert.equal(runCli(root, 'permissions', '--apply').status, 0);
    assert.equal(runCli(root, 'permissions', '--apply').status, 0);

    assert.equal(await readFile(path.join(home, 'state.json'), 'utf8'), stateBefore);
    assert.deepEqual((await readdir(home, { recursive: true })).sort(), entriesBefore);
  });
});

test('permissions rejects --apply with any other command and changes nothing', async () => {
  await withTemporaryProject(async (root) => {
    for (const command of ['init', 'status', 'install', 'decline', 'onboarding', 'link', 'update-check']) {
      const result = runCli(root, command, '--apply');

      assert.equal(result.status, 2, command);
      assert.match(result.stderr, /--apply/);
    }
    const language = runCli(root, 'language', 'vi', '--apply');
    assert.equal(language.status, 2);
    assert.equal(await pathExists(path.join(root, '.noah-kit')), false);
    assert.equal(await pathExists(path.join(root, '.claude')), false);
    await assertNoNoahHome(root);
  });
});

test('permissions rejects --source, --force, and extra positional arguments with exit 2 and writes nothing', async () => {
  await withTemporaryProject(async (root) => {
    await initializedProject(root);
    const attempts = [
      ['permissions', '--source', 'https://example.invalid/index.json'],
      ['permissions', '--force'],
      ['permissions', '--apply', '--force'],
      ['permissions', '--apply', '--source', 'https://example.invalid/index.json'],
      ['permissions', 'now'],
      ['permissions', '--apply', 'now'],
      ['permissions', 'apply']
    ];
    for (const args of attempts) {
      const result = runCli(root, ...args);

      assert.equal(result.status, 2, args.join(' '));
      assert.equal(result.stdout, '');
      assert.equal(await pathExists(settingsPathOf(root)), false, `${args.join(' ')} must not create the settings file`);
    }
    await assertNoNoahHome(root);
  });
});

test('init installs workflow skills and the Stop hook idempotently while printing the permissions pointer', async () => {
  await withTemporaryProject(async (root) => {
    const fresh = runCli(root, 'init');

    assert.equal(fresh.status, 0, fresh.stderr);
    assert.ok(fresh.stdout.includes(`${POINTER_LINE}\n`), fresh.stdout);
    assert.equal(fresh.stdout.split(POINTER_LINE).length - 1, 1);
    const settingsAfterFirstRun = JSON.parse(await readFile(settingsPathOf(root), 'utf8'));
    assert.equal(settingsAfterFirstRun.hooks.Stop.length, 1);
    assert.match(settingsAfterFirstRun.hooks.Stop[0].hooks[0].command, /\.noah-kit\/runtime\/scripts\/stop-gate\.js/);
    for (const skill of ['workflow-orchestration', 'failure-diagnosis', 'efficient-verification']) {
      assert.ok(await pathExists(path.join(root, '.claude', 'skills', skill, 'SKILL.md')), skill);
    }
    assert.ok(await pathExists(path.join(root, '.noah-kit', 'runtime', 'scripts', 'verify-run.js')));

    const repeated = runCli(root, 'init');

    assert.equal(repeated.status, 0, repeated.stderr);
    assert.match(repeated.stdout, /No changes needed/);
    assert.ok(repeated.stdout.includes(`${POINTER_LINE}\n`), repeated.stdout);
    assert.equal(repeated.stdout.split(POINTER_LINE).length - 1, 1);
    const settingsAfterSecondRun = JSON.parse(await readFile(settingsPathOf(root), 'utf8'));
    assert.equal(settingsAfterSecondRun.hooks.Stop.length, 1);
    assert.deepEqual((await readdir(path.join(root, '.claude', 'skills'))).sort(), ['efficient-verification', 'failure-diagnosis', 'workflow-orchestration']);
  });
});

test('init preserves existing settings while merging the Noah Kit Stop hook', async () => {
  await withTemporaryProject(async (root) => {
    await mkdir(path.dirname(settingsPathOf(root)), { recursive: true });
    await writeFile(settingsPathOf(root), SETTINGS_CONFLICT_RULES_MISSING);

    const result = runCli(root, 'init');

    assert.equal(result.status, 0, result.stderr);
    const settings = JSON.parse(await readFile(settingsPathOf(root), 'utf8'));
    assert.equal(settings.model, 'sonnet');
    assert.deepEqual(settings.permissions, { allow: ['Bash(ls)'] });
    assert.equal(settings.hooks.Stop.length, 1);
    assert.match(settings.hooks.Stop[0].hooks[0].command, /stop-gate\.js/);
  });
});

test('help and the unsupported-command message list permissions and --apply', async () => {
  await withTemporaryProject(async (root) => {
    const help = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /noah permissions \[--apply\]/);
    assert.match(help.stdout, /--apply/);

    const unsupported = runCli(root, 'nope');
    assert.equal(unsupported.status, 2);
    assert.match(unsupported.stderr, /Supported commands: .*language, permissions\./);
  });
});

test('drift: the proposed rules cover the files Noah Kit itself writes to local state and the installed Core', async () => {
  await withTemporaryProject(async (root) => {
    assert.equal(runCli(root, 'install').status, 0);
    const home = path.join(root, '.test-noah-home');
    const toGlobPath = (absolute) => `~/.noah-kit/${path.relative(home, absolute).split(path.sep).join('/')}`;

    const stateFile = toGlobPath(path.join(home, 'state.json'));
    const marker = toGlobPath(path.join(home, 'versions', CORE_VERSION, 'core-manifest.json'));
    const entry = toGlobPath(path.join(home, 'versions', CORE_VERSION, 'src', 'cli.js'));
    assert.ok(await pathExists(path.join(home, 'state.json')));
    assert.ok(await pathExists(path.join(home, 'versions', CORE_VERSION, 'core-manifest.json')));
    assert.ok(await pathExists(path.join(home, 'versions', CORE_VERSION, 'src', 'cli.js')));

    const rules = PERMISSION_RULES.map((item) => /^Read\((.*)\)$/.exec(item.rule)[1]);
    const covers = (rule, file) => (rule.endsWith('/**') ? file.startsWith(rule.slice(0, -2)) : rule === file);
    assert.ok(rules.some((rule) => covers(rule, stateFile)), `${stateFile} must be covered`);
    assert.ok(rules.some((rule) => covers(rule, marker)), `${marker} must be covered`);
    assert.ok(rules.some((rule) => covers(rule, entry)), `${entry} must be covered`);
  });
});
