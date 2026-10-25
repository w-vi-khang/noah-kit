#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getNoahHome, loadLocalState, saveLocalState } from './local-state.js';
import { createLaunchers } from './launcher.js';
import { describeLanguage, normalizeLanguageTag } from './preferences.js';
import { DEFAULT_RELEASE_SOURCE, describeReleaseSource, isValidChannel, loadReleaseIndex, selectUpdateCandidate } from './release-index.js';
import { FAILURE_RETRY_MINUTES, evaluateUpdateCheck, resolveUpdatePolicy } from './update-policy.js';
import { compareVersions, isVersionCompatible } from './version.js';

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
  noah link
  noah update-check [--cwd <path>] [--source <https-url|file>] [--force]
  noah language [<tag>|clear]
  noah --version
  noah --help

Commands:
  init       Initialize or validate project configuration
  install    Install the current Core version into user-local storage
  status     Show local Core installation and current project status
  decline    Remember a declined installation choice in user-local state
  onboarding Report whether installation should be offered for this project
  link       Create user-local launcher files without changing PATH
  update-check
             Check the release index for a newer compatible Core when the
             project's check schedule is due. Reports only; never installs.
  language   Show, set, or clear the language Claude Code uses to talk to
             you, for example "noah language vi". Stored in user-local
             state only; code and technical artifacts stay in English.

Options:
  --cwd      Target project directory (defaults to the current directory)
  --source   Release index location for update-check (https:// URL or local
             file). Defaults to the official index.
  --force    Run update-check even when the schedule says it is not due
  --help     Show this help message
  --version  Show the CLI version
`);
}

function parseArguments(args) {
  const result = { command: null, arguments: [], cwd: process.cwd(), help: false, version: false, source: undefined, force: false };

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
    } else if (argument === '--source') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Option --source requires a URL or file path.');
      }
      result.source = value;
      index += 1;
    } else if (argument === '--force') {
      result.force = true;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (result.command === null) {
      result.command = argument;
    } else {
      result.arguments.push(argument);
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
- Talk to the user in the language set in \`preferences.communication_language\` of the user-local state file described below (for example, \`vi\` is Vietnamese). This covers conversation, explanations, questions, and status reports only; code and technical artifacts stay in English. If it is not set, reply in the language the user writes in. The user can change it with \`npx --yes github:w-vi-khang/noah-kit language <tag>\`.
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
    const { declined_install_at, declined_remind_after_days, ...registeredProjectState } = previousProjectState;
    state.projects[projectManifest.project.id] = {
      ...registeredProjectState,
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

async function isValidCoreInstallation(version, installation) {
  const markerPath = path.join(installation.path, 'core-manifest.json');
  const cliPath = path.join(installation.path, 'src', 'cli.js');
  if (!(await exists(markerPath)) || !(await exists(cliPath))) return false;
  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf8'));
  } catch {
    return false;
  }
  return marker?.schema_version === 1 && marker.package_name === 'noah-kit' && marker.version === version;
}

async function showOnboarding(root) {
  const projectManifest = await readProjectManifest(root);
  if (!projectManifest) {
    process.stdout.write('NO_KIT_PROJECT: no Noah Kit manifest found.\n');
    return;
  }

  const versionRange = projectManifest.kit.core_version_range;
  const noahHome = getNoahHome();
  const state = await loadLocalState(noahHome);
  const projectState = state.projects[projectManifest.project.id];

  for (const [version, installation] of Object.entries(state.installations)) {
    if (!isVersionCompatible(version, versionRange)) continue;
    if (await isValidCoreInstallation(version, installation)) {
      process.stdout.write(`CORE_READY: compatible Core ${version} is installed at ${installation.path}.\n`);
      return;
    }
  }

  if (!isVersionCompatible(CLI_VERSION, versionRange)) {
    process.stdout.write(`NO_COMPATIBLE_RELEASE: current CLI ${CLI_VERSION} does not satisfy required range ${versionRange}. Do not attempt installation with this release.\n`);
    return;
  }

  if (projectState?.declined_install_at) {
    const declinedAt = Date.parse(projectState.declined_install_at);
    const remindAfterDays = Number.isInteger(projectState.declined_remind_after_days) && projectState.declined_remind_after_days >= 0
      ? projectState.declined_remind_after_days
      : (Number.isInteger(projectManifest.updates?.remind_after_days) && projectManifest.updates.remind_after_days >= 0 ? projectManifest.updates.remind_after_days : 1);
    const reminderAt = declinedAt + remindAfterDays * 24 * 60 * 60 * 1000;
    if (Number.isFinite(declinedAt) && Date.now() < reminderAt) {
      process.stdout.write(`INSTALL_DECLINED: do not prompt again before ${new Date(reminderAt).toISOString()}.\n`);
      return;
    }
  }

  process.stdout.write('PROMPT_INSTALL: no compatible Core is registered; ask the user before installing.\n');
}

// The newest valid local Core that satisfies the project range, or the running
// CLI version when none is installed. Releases are compared against this.
async function findBaselineVersion(state, versionRange) {
  let baseline = null;
  for (const [version, installation] of Object.entries(state.installations)) {
    if (versionRange && !isVersionCompatible(version, versionRange)) continue;
    if (!(await isValidCoreInstallation(version, installation))) continue;
    if (!baseline || compareVersions(version, baseline) > 0) baseline = version;
  }
  return baseline ?? CLI_VERSION;
}

async function checkForUpdates(root, { source, force }) {
  const projectManifest = await readProjectManifest(root);
  const updates = projectManifest?.updates;
  const policy = resolveUpdatePolicy(updates);
  const channel = updates?.channel ?? 'stable';
  if (!isValidChannel(channel)) {
    throw new Error(`Unsupported updates.channel "${channel}".`);
  }
  const versionRange = projectManifest?.kit.core_version_range ?? null;
  if (versionRange) {
    // Surface range syntax errors as configuration errors before any state is
    // written, instead of recording them as a failed release check.
    isVersionCompatible(CLI_VERSION, versionRange);
  }
  // The source is deliberately not read from the environment or the manifest,
  // which committed project configuration can influence.
  const releaseSource = describeReleaseSource(source ?? DEFAULT_RELEASE_SOURCE);
  const noahHome = getNoahHome();
  const state = await loadLocalState(noahHome);

  if (!force) {
    // A record from a different source says nothing about this source.
    const previous = state.update_checks?.[channel];
    const decision = evaluateUpdateCheck(previous?.source === releaseSource.location ? previous : undefined, policy);
    if (decision.reason === 'DISABLED') {
      process.stdout.write('CHECK_DISABLED: updates.check_on_startup is false for this project. Use --force to check manually.\n');
      return 0;
    }
    if (!decision.due) {
      process.stdout.write(`CHECK_NOT_DUE: the next ${channel} release check is due at ${decision.nextCheckAt.toISOString()} (${decision.reason}). Use --force to check now.\n`);
      return 0;
    }
  }

  const baselineVersion = await findBaselineVersion(state, versionRange);
  const attemptedAt = new Date().toISOString();
  let candidate = null;
  let failure = null;
  try {
    const { index } = await loadReleaseIndex(releaseSource.location);
    candidate = selectUpdateCandidate(index, { channel, baselineVersion, versionRange });
  } catch (error) {
    failure = error.message;
  }

  // Reload before writing so changes made by another command during the
  // network request are not discarded.
  const latestState = await loadLocalState(noahHome);
  const record = {
    ...(latestState.update_checks?.[channel] ?? {}),
    source: releaseSource.location,
    last_attempt_at: attemptedAt
  };
  if (failure) {
    record.last_result = 'FAILED';
    record.last_error = failure.slice(0, 500);
  } else {
    delete record.last_error;
    record.last_result = candidate ? 'UPDATE_AVAILABLE' : 'UP_TO_DATE';
    record.last_success_at = attemptedAt;
    record.latest_known_version = candidate?.version ?? null;
  }
  latestState.update_checks = { ...(latestState.update_checks ?? {}), [channel]: record };
  await saveLocalState(noahHome, latestState);

  if (releaseSource.location !== DEFAULT_RELEASE_SOURCE) {
    process.stderr.write(`Warning: using a non-default release source: ${releaseSource.location}\n`);
  }
  const rangeDescription = versionRange ? `the project range "${versionRange}"` : 'no project range (no manifest found)';
  if (failure) {
    process.stdout.write(`CHECK_FAILED: ${failure}\nThe failure was recorded in local state. The next scheduled check waits at least ${FAILURE_RETRY_MINUTES} minutes; use --force to retry sooner.\n`);
    return 1;
  }
  if (!candidate) {
    process.stdout.write(`UP_TO_DATE: no ${channel} release newer than ${baselineVersion} satisfies ${rangeDescription}.\n`);
    return 0;
  }
  process.stdout.write(`UPDATE_AVAILABLE: Core ${candidate.version} (${candidate.classification}, published ${candidate.published_at}) is newer than ${baselineVersion} and satisfies ${rangeDescription}.\nPinned source: ${candidate.source.repository} at commit ${candidate.source.commit}.\nNothing was downloaded or installed. Installing releases from the index is not implemented yet.\n`);
  if (updates?.auto_install === true) {
    process.stdout.write('Note: updates.auto_install is ignored; automatic installation is not implemented.\n');
  }
  return 0;
}
async function configureLanguage(value) {
  const noahHome = getNoahHome();
  const state = await loadLocalState(noahHome);
  const current = state.preferences?.communication_language;

  if (value === undefined) {
    process.stdout.write(current
      ? `Communication language: ${describeLanguage(current)}\n`
      : 'Communication language: not set. Claude Code replies in the language you write in.\n');
    return;
  }

  if (value === 'clear') {
    if (state.preferences) {
      const { communication_language, ...remainingPreferences } = state.preferences;
      state.preferences = remainingPreferences;
    }
    await saveLocalState(noahHome, state);
    process.stdout.write('Communication language cleared from user-local state. No project files were changed.\n');
    return;
  }

  const language = normalizeLanguageTag(value);
  state.preferences = { ...(state.preferences ?? {}), communication_language: language };
  await saveLocalState(noahHome, state);
  process.stdout.write(`Communication language set to ${describeLanguage(language)} in user-local state.\nThis affects conversation only; code and technical artifacts stay in English. No project files were changed.\n`);
}

async function showStatus(root) {
  const noahHome = getNoahHome();
  const state = await loadLocalState(noahHome);
  const installedVersions = Object.keys(state.installations).sort();
  const projectManifest = await readProjectManifest(root);

  process.stdout.write('Noah Kit status\n');
  const language = state.preferences?.communication_language;
  process.stdout.write(`Communication language: ${language ? describeLanguage(language) : 'not set'}\n`);
  if (installedVersions.length === 0) {
    process.stdout.write('Core: not registered as installed\n');
  } else {
    for (const version of installedVersions) {
      const installation = state.installations[version];
      const markerPath = path.join(installation.path, 'core-manifest.json');
      const markerExists = await exists(markerPath);
      const sourceExists = await exists(path.join(installation.path, 'src', 'cli.js'));
      process.stdout.write(`Core ${version}: ${markerExists && sourceExists ? 'installed' : 'missing or incomplete'} (${installation.path})\n`);
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
  if (!['init', 'install', 'status', 'decline', 'onboarding', 'link', 'update-check', 'language'].includes(options.command)) {
    process.stderr.write('A command is required. Supported commands: init, install, status, decline, onboarding, link, update-check, language.\nUse --help to see usage.\n');
    return 2;
  }
  const maximumArguments = options.command === 'language' ? 1 : 0;
  if (options.arguments.length > maximumArguments) {
    process.stderr.write(`Unexpected argument: ${options.arguments[maximumArguments]}\nUse --help to see available commands.\n`);
    return 2;
  }
  if (options.command !== 'update-check' && (options.source !== undefined || options.force)) {
    process.stderr.write('Options --source and --force are only supported by update-check.\n');
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
    } else if (options.command === 'language') {
      await configureLanguage(options.arguments[0]);
    } else if (options.command === 'update-check') {
      return await checkForUpdates(options.cwd, options);
    } else if (options.command === 'link') {
      const launchers = await createLaunchers();
      process.stdout.write(`Created Noah Kit launchers in:\n  ${launchers.binDirectory}\nAdd this directory to your PATH manually if you want to run noah from any terminal. No shell configuration was changed.\n`);
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
