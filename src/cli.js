#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getNoahHome, loadLocalState, saveLocalState } from './local-state.js';

const CLI_VERSION = '0.1.0';
const MANIFEST_PATH = path.join('.noah-kit', 'manifest.json');
const CLAUDE_RULE_PATH = path.join('.claude', 'rules', 'noah-kit.md');
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function printHelp() {
  process.stdout.write(`Noah Kit ${CLI_VERSION}

Usage:
  noah init [--cwd <path>]
  noah install [--cwd <path>]
  noah status [--cwd <path>]
  noah decline [--cwd <path>]
  noah onboarding [--cwd <path>]
  noah --version
  noah --help

Commands:
  init       Initialize or validate project configuration
  install    Install the current Core version into user-local storage
  status     Show local Core installation and current project status
  decline    Remember a declined installation choice in user-local state
  onboarding Report whether installation should be offered for this project

Options:
  --cwd      Target project directory (defaults to the current directory)
  --help     Show this help message
  --version  Show the CLI version
`);
}

function parseArguments(args) {
  const result = { command: null, cwd: process.cwd(), help: false, version: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--help' || argument === '-h') {
      result.help = true;
    } else if (argument === '--version' || argument === '-v') {
      result.version = true;
    } else if (argument === '--cwd') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Option --cwd requires a directory path.');
      }
      result.cwd = path.resolve(value);
      index += 1;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (result.command === null) {
      result.command = argument;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }

  return result;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('The Noah Kit manifest must contain a JSON object.');
  }
  if (manifest.schema_version !== 1) {
    throw new Error('Unsupported or missing schema_version. Expected 1.');
  }
  if (manifest.kit?.id !== 'noah-kit') {
    throw new Error('The manifest kit.id must be "noah-kit".');
  }
  if (typeof manifest.kit?.core_version_range !== 'string' || !manifest.kit.core_version_range.trim()) {
    throw new Error('The manifest must define kit.core_version_range.');
  }
  if (typeof manifest.project?.id !== 'string' || !manifest.project.id.trim() || manifest.project.id.startsWith('replace-')) {
    throw new Error('The manifest must define a stable project.id.');
  }
  if (typeof manifest.project?.name !== 'string' || !manifest.project.name.trim() || manifest.project.name.startsWith('replace-')) {
    throw new Error('The manifest must define project.name.');
  }
  if (typeof manifest.project?.type !== 'string' || !manifest.project.type.trim()) {
    throw new Error('The manifest must define project.type.');
  }
  return manifest;
}

async function readProjectManifest(root) {
  const manifestPath = path.join(root, MANIFEST_PATH);
  if (!(await exists(manifestPath))) return null;

  try {
    return validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${MANIFEST_PATH} is not valid JSON.`);
    }
    throw error;
  }
}

async function loadProjectName(root) {
  const packagePath = path.join(root, 'package.json');
  if (await exists(packagePath)) {
    try {
      const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
      if (typeof packageJson.name === 'string' && packageJson.name.trim()) return packageJson.name.trim();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('The existing package.json is not valid JSON; fix it before initializing Noah Kit.');
      }
      throw error;
    }
  }
  return path.basename(root) || 'unnamed-project';
}

function createManifest(projectName) {
  return {
    schema_version: 1,
    kit: {
      id: 'noah-kit',
      core_version_range: '>=0.1.0 <0.2.0'
    },
    project: {
      id: randomUUID(),
      name: projectName,
      type: 'application'
    },
    installation: {
      prompt_on_missing_core: true,
      remember_declined_install_locally: true
    },
    updates: {
      check_on_startup: true,
      auto_install: false,
      check_after_local_time: '17:00',
      timezone: 'local',
      remind_after_days: 1,
      channel: 'stable'
    },
    capabilities: {
      skills: true,
      subagents: true,
      hooks: false,
      migrations: false
    }
  };
}

function createClaudeInstructions() {
  return `# Noah Kit Project Instructions

This project declares Noah Kit in \`.noah-kit/manifest.json\`. Read that manifest before applying Noah Kit workflows.

## Mandatory rules

- Write all code, identifiers, code comments, tests, configuration keys, and technical documentation in English.
- Treat \`.noah-kit/manifest.json\` as committed project configuration, not as a place for user-local state or secrets.
- Do not claim a test or verification passed unless it was actually run and its result was observed.
- Preserve user changes. Do not overwrite conflicting files or run project scripts and migrations merely because they are referenced by configuration.
- Before prompting, read this project's manifest and inspect the user-local state file at \`~/.noah-kit/state.json\` (or the directory configured by \`NOAH_HOME\`). Match the entry by \`project.id\`.
- If \`declined_install_at\` exists and fewer than \`updates.remind_after_days\` days have elapsed, do not prompt again in this session. If the interval has elapsed, ask again.
- Treat Core as installed only when local state and its \`core-manifest.json\` marker agree. Check the project's Core version range; do not assume an incompatible version is usable.
- If no compatible Core is installed and no recent decline suppresses the prompt, ask the user whether they want to install it. Only after approval, suggest running \`npx --yes github:w-vi-khang/noah-kit install\`. Do not silently download or execute code.
- If the user declines, offer to record that choice locally with \`npx --yes github:w-vi-khang/noah-kit decline\`. Never write a declined-install choice into the committed manifest.
- Do not imply reminders or scheduled checks run while Claude Code is closed. Startup reminders are evaluated only when this rule is followed in a later session.

## Project setup

The manifest is the source of project-specific Noah Kit settings. Keep reusable kit implementation outside this repository. Store installation choices, caches, logs, and update timestamps in user-local state outside version control.
`;
}

async function initializeProject(root) {
  const manifestAbsolutePath = path.join(root, MANIFEST_PATH);
  const claudeRuleAbsolutePath = path.join(root, CLAUDE_RULE_PATH);
  const manifestExists = await exists(manifestAbsolutePath);
  const ruleExists = await exists(claudeRuleAbsolutePath);
  let manifest;
  let manifestContent;
  let ruleContent;

  if (manifestExists) {
    manifest = await readProjectManifest(root);
  } else {
    manifest = createManifest(await loadProjectName(root));
    manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  }

  if (!ruleExists) {
    ruleContent = createClaudeInstructions();
  }

  const plannedChanges = [];
  if (!manifestExists) plannedChanges.push(MANIFEST_PATH);
  if (!ruleExists) plannedChanges.push(CLAUDE_RULE_PATH);

  if (plannedChanges.length === 0) {
    process.stdout.write(`No changes needed. Existing Noah Kit files were preserved.\nProject: ${manifest.project.name} (${manifest.project.id})\n`);
    return;
  }

  try {
    if (!manifestExists) {
      await mkdir(path.dirname(manifestAbsolutePath), { recursive: true });
      await writeFile(manifestAbsolutePath, manifestContent, { flag: 'wx' });
    }
    if (!ruleExists) {
      await mkdir(path.dirname(claudeRuleAbsolutePath), { recursive: true });
      await writeFile(claudeRuleAbsolutePath, ruleContent, { flag: 'wx' });
    }
  } catch (error) {
    throw new Error(`Initialization could not finish while creating ${error.path ?? 'a project file'}. Review the working tree before retrying. Original error: ${error.message}`);
  }

  process.stdout.write(`Initialized Noah Kit project files:\n${plannedChanges.map((item) => `  - ${item}`).join('\n')}\nProject: ${manifest.project.name} (${manifest.project.id})\nReview and commit these files. User-local state is not created in the project.\n`);
}

function compareVersions(left, right) {
  if (!/^\\d+\\.\\d+\\.\\d+$/.test(left) || !/^\\d+\\.\\d+\\.\\d+$/.test(right)) {
    throw new Error('Core versions must use the stable MAJOR.MINOR.PATCH format.');
  }
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function isVersionCompatible(version, range) {
  const terms = range.trim().split(/\s+/);
  if (terms.length === 0 || !range.trim()) {
    throw new Error('The project Core version range is empty.');
  }

  return terms.every((term) => {
    const match = term.match(/^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/);
    if (!match) {
      throw new Error(`Unsupported Core version range syntax: "${range}". Use space-separated exact versions or >=, >, <=, < constraints.`);
    }
    const operator = match[1] ?? '=';
    const comparison = compareVersions(version, match[2]);
    if (operator === '>=') return comparison >= 0;
    if (operator === '>') return comparison > 0;
    if (operator === '<=') return comparison <= 0;
    if (operator === '<') return comparison < 0;
    return comparison === 0;
  });
}
async function readPackageMetadata() {
  const packagePath = path.join(PACKAGE_ROOT, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  if (packageJson.name !== 'noah-kit' || packageJson.version !== CLI_VERSION) {
    throw new Error('The package metadata does not match the running Noah Kit CLI version.');
  }
  if (!(await exists(path.join(PACKAGE_ROOT, 'src', 'cli.js')))) {
    throw new Error('The Core source files are incomplete; installation was not started.');
  }
  return packageJson;
}

async function installCore(root) {
  const packageJson = await readPackageMetadata();
  const projectManifest = await readProjectManifest(root);
  if (projectManifest && !isVersionCompatible(CLI_VERSION, projectManifest.kit.core_version_range)) {
    throw new Error(`Core version ${CLI_VERSION} does not satisfy the project's required range "${projectManifest.kit.core_version_range}". No files were installed or changed.`);
  }
  const noahHome = getNoahHome();
  const versionsDirectory = path.join(noahHome, 'versions');
  const installDirectory = path.join(versionsDirectory, CLI_VERSION);
  const markerPath = path.join(installDirectory, 'core-manifest.json');
  const state = await loadLocalState(noahHome);
  let installedAt;

  if (await exists(installDirectory)) {
    if (!(await exists(markerPath))) {
      throw new Error(`The target directory ${installDirectory} already exists without a valid Noah Kit marker. It was not overwritten.`);
    }
    let marker;
    try {
      marker = JSON.parse(await readFile(markerPath, 'utf8'));
    } catch {
      throw new Error(`The existing Core marker at ${markerPath} is invalid. The installation was not overwritten.`);
    }
    if (marker.schema_version !== 1 || marker.package_name !== packageJson.name || marker.version !== CLI_VERSION) {
      throw new Error(`The existing Core directory ${installDirectory} does not match version ${CLI_VERSION}. It was not overwritten.`);
    }
    installedAt = marker.installed_at;
  } else {
    await mkdir(versionsDirectory, { recursive: true });
    const stagingDirectory = path.join(versionsDirectory, `.staging-${CLI_VERSION}-${randomUUID()}`);
    installedAt = new Date().toISOString();

    try {
      await mkdir(stagingDirectory, { recursive: false });
      await cp(path.join(PACKAGE_ROOT, 'src'), path.join(stagingDirectory, 'src'), { recursive: true, errorOnExist: true, force: false });
      await cp(path.join(PACKAGE_ROOT, 'package.json'), path.join(stagingDirectory, 'package.json'), { errorOnExist: true, force: false });
      const docsPath = path.join(PACKAGE_ROOT, 'docs');
      if (await exists(docsPath)) {
        await cp(docsPath, path.join(stagingDirectory, 'docs'), { recursive: true, errorOnExist: true, force: false });
      }
      await writeFile(path.join(stagingDirectory, 'core-manifest.json'), `${JSON.stringify({
        schema_version: 1,
        package_name: packageJson.name,
        version: CLI_VERSION,
        installed_at: installedAt,
        source: 'github:w-vi-khang/noah-kit'
      }, null, 2)}\n`, { flag: 'wx' });
      await rename(stagingDirectory, installDirectory);
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
      throw new Error(`Core installation failed before activation. The existing installation was not changed. ${error.message}`);
    }
  }

  state.installations[CLI_VERSION] = {
    version: CLI_VERSION,
    path: installDirectory,
    installed_at: installedAt,
    last_verified_at: new Date().toISOString()
  };

  if (projectManifest) {
    const previousProjectState = state.projects[projectManifest.project.id] ?? {};
    state.projects[projectManifest.project.id] = {
      ...previousProjectState,
      name: projectManifest.project.name,
      root_path: root,
      installed_version: CLI_VERSION,
      last_seen_at: new Date().toISOString()
    };
  }

  await saveLocalState(noahHome, state);
  process.stdout.write(`Noah Kit Core ${CLI_VERSION} is installed at:\n  ${installDirectory}\nLocal state:\n  ${path.join(noahHome, 'state.json')}\nNo project files were changed by the Core installer.\n`);
}

async function declineInstallation(root) {
  const projectManifest = await readProjectManifest(root);
  if (!projectManifest) {
    throw new Error(`No ${MANIFEST_PATH} found. Initialize the project before recording an installation choice.`);
  }

  const noahHome = getNoahHome();
  const state = await loadLocalState(noahHome);
  const now = new Date().toISOString();
  const previous = state.projects[projectManifest.project.id] ?? {};
  const remindAfterDays = Number.isInteger(projectManifest.updates?.remind_after_days) && projectManifest.updates.remind_after_days >= 0
    ? projectManifest.updates.remind_after_days
    : 1;

  state.projects[projectManifest.project.id] = {
    ...previous,
    name: projectManifest.project.name,
    root_path: root,
    declined_install_at: now,
    declined_remind_after_days: remindAfterDays,
    last_seen_at: now
  };

  await saveLocalState(noahHome, state);
  process.stdout.write(`Installation decline recorded in user-local state for ${projectManifest.project.name}.\nNo project files were changed.\nThe reminder interval is ${remindAfterDays} day(s); this command records the preference but does not schedule a background process.\n`);
}

async function showOnboarding(root) {
  const projectManifest = await readProjectManifest(root);
  if (!projectManifest) {
    process.stdout.write('NO_KIT_PROJECT: no Noah Kit manifest found.\\n');
    return;
  }

  const versionRange = projectManifest.kit.core_version_range;
  const noahHome = getNoahHome();
  const state = await loadLocalState(noahHome);
  const projectState = state.projects[projectManifest.project.id];

  for (const [version, installation] of Object.entries(state.installations)) {
    if (!isVersionCompatible(version, versionRange)) continue;
    const markerPath = path.join(installation.path, 'core-manifest.json');
    const cliPath = path.join(installation.path, 'src', 'cli.js');
    if (!(await exists(markerPath)) || !(await exists(cliPath))) continue;
    let marker;
    try {
      marker = JSON.parse(await readFile(markerPath, 'utf8'));
    } catch {
      continue;
    }
    if (marker.schema_version === 1 && marker.package_name === 'noah-kit' && marker.version === version) {
      process.stdout.write(`CORE_READY: compatible Core ${version} is installed at ${installation.path}.\\n`);
      return;
    }
  }

  if (!isVersionCompatible(CLI_VERSION, versionRange)) {
    process.stdout.write(`NO_COMPATIBLE_RELEASE: current CLI ${CLI_VERSION} does not satisfy required range ${versionRange}. Do not attempt installation with this release.\\n`);
    return;
  }

  if (projectState?.declined_install_at) {
    const declinedAt = Date.parse(projectState.declined_install_at);
    const remindAfterDays = Number.isInteger(projectState.declined_remind_after_days) && projectState.declined_remind_after_days >= 0
      ? projectState.declined_remind_after_days
      : (Number.isInteger(projectManifest.updates?.remind_after_days) && projectManifest.updates.remind_after_days >= 0 ? projectManifest.updates.remind_after_days : 1);
    const reminderAt = declinedAt + remindAfterDays * 24 * 60 * 60 * 1000;
    if (Number.isFinite(declinedAt) && Date.now() < reminderAt) {
      process.stdout.write(`INSTALL_DECLINED: do not prompt again before ${new Date(reminderAt).toISOString()}.\\n`);
      return;
    }
  }

  process.stdout.write('PROMPT_INSTALL: no compatible Core is registered; ask the user before installing.\\n');
}
async function showStatus(root) {
  const noahHome = getNoahHome();
  const state = await loadLocalState(noahHome);
  const installedVersions = Object.keys(state.installations).sort();
  const projectManifest = await readProjectManifest(root);

  process.stdout.write('Noah Kit status\n');
  if (installedVersions.length === 0) {
    process.stdout.write('Core: not registered as installed\n');
  } else {
    for (const version of installedVersions) {
      const installation = state.installations[version];
      const markerPath = path.join(installation.path, 'core-manifest.json');
      const markerExists = await exists(markerPath);
      process.stdout.write(`Core ${version}: ${markerExists ? 'installed' : 'missing or incomplete'} (${installation.path})\n`);
    }
  }

  if (!projectManifest) {
    process.stdout.write(`Project: no ${MANIFEST_PATH} found in ${root}\n`);
    return;
  }

  const projectState = state.projects[projectManifest.project.id];
  process.stdout.write(`Project: ${projectManifest.project.name} (${projectManifest.project.id})\n`);
  process.stdout.write(`Project registration: ${projectState ? 'known locally' : 'not yet registered locally'}\n`);
  if (projectState?.declined_install_at) {
    process.stdout.write(`Last declined installation: ${projectState.declined_install_at}\n`);
    process.stdout.write(`Reminder interval: ${projectState.declined_remind_after_days ?? 1} day(s)\n`);
  }
  process.stdout.write(`Required Core range: ${projectManifest.kit.core_version_range}\n`);
}

export async function run(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(args);
  } catch (error) {
    process.stderr.write(`${error.message}\nUse --help to see available commands.\n`);
    return 2;
  }

  if (options.help || options.command === 'help') {
    printHelp();
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }
  if (!['init', 'install', 'status', 'decline', 'onboarding'].includes(options.command)) {
    process.stderr.write('A command is required. Supported commands: init, install, status, decline, onboarding.\nUse --help to see usage.\n');
    return 2;
  }

  try {
    if (options.command === 'init') {
      await initializeProject(options.cwd);
    } else if (options.command === 'install') {
      await installCore(options.cwd);
    } else if (options.command === 'decline') {
      await declineInstallation(options.cwd);
    } else if (options.command === 'onboarding') {
      await showOnboarding(options.cwd);
    } else {
      await showStatus(options.cwd);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`Noah Kit ${options.command} failed: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`Unexpected error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
