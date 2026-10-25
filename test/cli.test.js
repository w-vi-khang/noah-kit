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

test('the generated rule forbids adding a Claude Code hook or Git hook and requires proposing it instead', async () => {
  const section = await generatedSection('## Correcting mistakes');
  assert.match(section, /MUST NOT add a Claude Code hook or a Git hook as a prevention measure\. If only a hook can prevent the mistake, MUST propose the hook to the user instead\./);
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
