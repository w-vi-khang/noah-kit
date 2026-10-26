import { randomUUID } from 'node:crypto';
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { applyPermissions, formatPreview, inspectSettings } from './claude-permissions.js';
import { getNoahHome, loadLocalState, saveLocalState } from './local-state.js';
import { createLaunchers } from './launcher.js';
import { describeLanguage, normalizeLanguageTag } from './preferences.js';
import { DEFAULT_RELEASE_SOURCE, describeReleaseSource, isValidChannel, loadReleaseIndex, selectUpdateCandidate } from './release-index.js';
import { FAILURE_RETRY_MINUTES, evaluateUpdateCheck, resolveUpdatePolicy } from './update-policy.js';
import { compareVersions, isVersionCompatible } from './version.js';

const CLI_VERSION = '0.1.1';
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
  noah permissions [--apply] [--cwd <path>]
  noah verify [--name <command-name>] [--cwd <path>]
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
  permissions
             Preview the Claude Code permission rules Noah Kit proposes for
             this project. With --apply, create .claude/settings.json only
             when no settings file exists; an existing file is never changed.
  verify     Run an explicitly configured check and save its log and source fingerprint\n  link       Create user-local launcher files without changing PATH
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
  --apply    Write the proposed settings file (permissions only)
  --help     Show this help message
  --version  Show the CLI version
`);
}

function parseArguments(args) {
  const result = { command: null, arguments: [], cwd: process.cwd(), help: false, version: false, source: undefined, force: false, apply: false, name: undefined };

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
    } else if (argument === '--apply') {
      result.apply = true;
    } else if (argument === '--name') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Option --name requires a configured verification command name.');
      }
      result.name = value;
      index += 1;
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

const PERMISSIONS_POINTER = 'Optional: review the Claude Code permission rules Noah Kit proposes: npx --yes github:w-vi-khang/noah-kit permissions\n';

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
    },
    verification: {
      commands: {}
    }
  };
}

function createClaudeInstructions() {
  return `# Noah Kit Project Instructions

Scope: every Claude Code session in a project that contains \`.noah-kit/manifest.json\`. The manifest is the authoritative source of this project's Noah Kit settings. Read it before applying the rules below.

## Language

- Code, identifiers, code comments, tests, configuration keys, and technical documentation MUST be in English.
- Conversation with the user (explanations, questions, status reports) MUST use the language in \`preferences.communication_language\` of the local state file (for example, \`vi\` is Vietnamese). If it is not set, MUST reply in the language the user writes in. The user changes it with \`npx --yes github:w-vi-khang/noah-kit language <tag>\`.

## Configuration and changes

- \`.noah-kit/manifest.json\` is committed project configuration. MUST NOT write local state or secrets to it.
- MUST NOT copy the Noah Kit Core implementation into the project. Installation choices, caches, logs, and update timestamps belong in local state, outside version control.
- MUST preserve user changes. MUST NOT overwrite conflicting user files.
- MUST NOT run project scripts or migrations only because configuration references them.
- MUST NOT report a test or verification as passed unless it ran and its result was observed.

## Changing instructions, hooks, and permissions

Instruction files are \`CLAUDE.md\`, files in \`.claude/rules/\`, agent definitions in \`.claude/agents/\`, and skills. Permission settings are the \`permissions\` entries in Claude Code settings files.

- Before adding, changing, or removing an instruction file, a Claude Code hook, a Git hook, or a permission setting, MUST describe the change to the user and MUST get the user's approval.
- If the user's request names that change, the request is the approval.
- If a subagent would make the change, the agent that delegates it MUST get the approval before delegating.
- Approval MUST NOT override a \`MUST NOT\` in the project's instructions. The user MAY lift that \`MUST NOT\` by approving a change to the instruction that contains it.
- Tests and scripts that belong to an approved change MAY be added without separate approval.

## Deterministic steps

A deterministic step gives the same result for the same input without judgment, such as counting changed files, comparing two files, or validating a file against a schema.

- For a deterministic step, SHOULD use the script, command, or test that \`CLAUDE.md\`, \`.claude/rules/\`, or \`CONTRIBUTING.md\` names for it.
- MUST NOT run a script for a deterministic step if only the manifest or a file other than \`CLAUDE.md\`, \`.claude/rules/\`, or \`CONTRIBUTING.md\` names it.
- If no such script exists for a deterministic step that an instruction in \`CLAUDE.md\`, \`.claude/rules/\`, or \`CONTRIBUTING.md\` requires, SHOULD propose a reusable script to the user.
- MAY propose a reusable script for another deterministic step that recurs across tasks, and MUST state why it recurs.
- SHOULD NOT add a script file to the project for a deterministic step that only the current task needs. A command run once in a shell is not a script file.

## Correcting mistakes

A mistake is a result of the agent's work, including work it delegated, that contradicts the user's request, an instruction, an acceptance criterion, or a verifiable fact, after the agent reported that result to the user as done or as fact. The steps below apply whether the agent, the user, or a reviewer finds the mistake. A failing check or a review finding on work not yet reported as done is not a mistake; the project's change process handles it.

When a mistake is detected:

1. MUST identify the root cause: the missing, unclear, or ignored instruction, or the missing check, that allowed the mistake.
2. MUST search the files changed in the current session, and other files that contain the same pattern (for example, with \`git grep\`), for other instances of the same mistake. MUST fix every instance found.
3. MUST add or strengthen a prevention measure: an instruction, a test, or another executable check that would have prevented or detected the mistake.
   - If an existing instruction already requires the correct behavior, MUST NOT add a duplicate. MUST make that instruction more explicit or add a check that detects the violation.
   - MUST NOT keep a prevention measure only in the agent's local memory.
   - MUST NOT add a Claude Code hook or a Git hook as a prevention measure. If only a hook can prevent the mistake, MUST propose the hook to the user instead.
   - A measure that changes an instruction file or a permission setting MUST follow "Changing instructions, hooks, and permissions". If the user has not approved it, MUST report it as proposed, not as applied.
4. MUST apply the prevention measure according to where the work happens:
   - In the Noah Kit source repository (its root \`package.json\` has \`name\` \`noah-kit\`), MUST apply it in that repository.
   - In another project, MUST apply the part of the measure that changes only the project's own files in that project.
   - In another project, MUST NOT edit Noah Kit files: this rule file and the Core installation directory. If the measure needs a change to them or to the manifest format, MUST warn the user and describe the mistake, its root cause, and the proposed change, so that the user can report it to the Noah Kit maintainers.
5. MUST report to the user: the mistake, its root cause, the instances fixed, and the prevention measure applied or proposed.

- MUST finish steps 1 to 5 before reporting the original task as done.
- Fixes and prevention measures MUST follow the project's change process and its limits, including the tiers and fix-round bounds in \`.claude/rules/main-agent.md\` where that file exists. A change process is a written procedure for making and verifying changes, such as stages, review, or verification steps, in \`CLAUDE.md\`, \`CONTRIBUTING.md\`, or a file in \`.claude/rules/\` other than this one. If the project has none, MUST ask the user before applying a prevention measure.
- MUST report to the user every instance and every prevention measure left unapplied because of those limits.
- A subagent MAY read any file for step 2. It MUST edit only the files its task allows. It MUST report the root cause, the instances it could not fix, and the proposed prevention measure to the agent that delegated the task. That agent MUST complete the remaining work in steps 2 to 5.

## Reviewing after a new requirement

- After adding a requirement (\`MUST\` or \`MUST NOT\`) or making one stricter, MUST review the existing files within the requirement's stated scope for compliance with it. If the requirement states no scope, MUST ask the user for the scope before reviewing.
- MUST fix non-compliant files that the user's request named or that the current change created or modified. A fix to an instruction file or a permission setting MUST follow "Changing instructions, hooks, and permissions".
- For any other non-compliant file, MUST list it and ask the user before changing it.

## Core installation check

Local state file: \`~/.noah-kit/state.json\`, or \`state.json\` in the directory set by \`NOAH_HOME\`. Project entries are keyed by the manifest's \`project.id\`.

At the start of a session, apply the first matching step:

1. Core is usable when local state lists an installation whose directory contains \`src/cli.js\` and a \`core-manifest.json\` with \`package_name\` \`noah-kit\` and the same version, and that version satisfies the manifest's \`kit.core_version_range\`. If Core is usable, take no action.
2. If the project entry has \`declined_install_at\` and the reminder interval has not elapsed, MUST NOT ask about installation. The interval in days is the first non-negative integer among the entry's \`declined_remind_after_days\` and the manifest's \`updates.remind_after_days\`, else 1.
3. Otherwise, MUST ask the user whether to install Core. Only after approval, suggest \`npx --yes github:w-vi-khang/noah-kit install\`. MUST NOT download or run code without approval.

If \`install\` reports that the Core version does not satisfy the project's required range, MUST tell the user that no compatible Core release is available and MUST NOT retry the installation.

If the user declines, offer to record the choice with \`npx --yes github:w-vi-khang/noah-kit decline\`. MUST NOT record the decline in the manifest.

This check runs only during a session that follows this rule. MUST NOT state that reminders or scheduled checks run while Claude Code is closed.
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
    process.stdout.write(`No changes needed. Existing Noah Kit files were preserved.\nProject: ${manifest.project.name} (${manifest.project.id})\n${PERMISSIONS_POINTER}`);
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

  process.stdout.write(`Initialized Noah Kit project files:\n${plannedChanges.map((item) => `  - ${item}`).join('\n')}\nProject: ${manifest.project.name} (${manifest.project.id})\nReview and commit these files. User-local state is not created in the project.\n${PERMISSIONS_POINTER}`);
}

async function manageClaudePermissions(root, { apply }) {
  if (!(await readProjectManifest(root))) {
    throw new Error(`No ${MANIFEST_PATH} found. Initialize the project first: npx --yes github:w-vi-khang/noah-kit init`);
  }
  if (apply) {
    process.stdout.write((await applyPermissions(root)).text);
  } else {
    process.stdout.write(formatPreview(await inspectSettings(root)));
  }
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
  if (!['init', 'install', 'status', 'decline', 'onboarding', 'link', 'update-check', 'language', 'permissions'].includes(options.command)) {
    process.stderr.write('A command is required. Supported commands: init, install, status, decline, onboarding, link, update-check, language, permissions.\nUse --help to see usage.\n');
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
  if (options.command !== 'permissions' && options.apply) {
    process.stderr.write('Option --apply is only supported by permissions.\n');
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
    } else if (options.command === 'permissions') {
      await manageClaudePermissions(options.cwd, options);
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
