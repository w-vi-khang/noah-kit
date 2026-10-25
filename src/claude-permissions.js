import { lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

// Authoritative list of the Claude Code permission rules Noah Kit proposes.
// Each rule needs a reason tied to behavior the generated rule file requires.
// Excluded on purpose: Agent (needs no permission), Bash, WebFetch, Edit,
// defaultMode, hooks, and any machine-specific path.
export const PERMISSION_RULES = Object.freeze([
  Object.freeze({
    rule: 'Read(~/.noah-kit/state.json)',
    reason: 'The Core installation check reads local state at session start; Read prompts for paths outside the working directory.'
  }),
  Object.freeze({
    rule: 'Read(~/.noah-kit/versions/**)',
    reason: 'Step 1 of the Core installation check reads core-manifest.json and looks for src/cli.js under the installation directory.'
  })
]);

export const SETTINGS_DISPLAY_PATH = '.claude/settings.json';
const CLAUDE_DIRECTORY = '.claude';
const SETTINGS_FILE = 'settings.json';

const PRECEDENCE_NOTE = 'Deny and ask rules, and managed settings, take precedence over these rules.';

export const PREVIEW_NOTES = Object.freeze([
  'Claude Code applies permissions.allow rules from project settings only after the workspace trust dialog is accepted; claude -p and SDK sessions in a folder that was never trusted do not apply them.',
  PRECEDENCE_NOTE,
  'This command cannot see user settings or managed settings.',
  'A committed settings file affects every collaborator after they trust the workspace.',
  'A NOAH_HOME override is not covered because a committed file must not hold a machine-specific path.',
  'Whether Claude Code lists these rules in the trust dialog and stops prompting for the Core check has not been verified in a live session.'
]);

export function createSettings() {
  return { permissions: { allow: PERMISSION_RULES.map((entry) => entry.rule) } };
}

function formatSettings(settings) {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

// Pure classification of existing settings file content. Returns
// ALREADY_PRESENT, CONFLICT_EXISTING_FILE (valid, some rules missing), or
// CONFLICT_INVALID_FILE (not usable; `detail` says why).
export function classifySettings(content) {
  let settings;
  try {
    settings = JSON.parse(content);
  } catch {
    return { status: 'CONFLICT_INVALID_FILE', missing: [], detail: `${SETTINGS_DISPLAY_PATH} is not valid JSON.` };
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { status: 'CONFLICT_INVALID_FILE', missing: [], detail: `${SETTINGS_DISPLAY_PATH} must contain a JSON object.` };
  }
  const permissions = settings.permissions;
  if (permissions !== undefined && (!permissions || typeof permissions !== 'object' || Array.isArray(permissions))) {
    return { status: 'CONFLICT_INVALID_FILE', missing: [], detail: 'The "permissions" value must be a JSON object.' };
  }
  const allow = permissions?.allow;
  if (allow !== undefined && !Array.isArray(allow)) {
    return { status: 'CONFLICT_INVALID_FILE', missing: [], detail: 'The "permissions.allow" value must be an array.' };
  }
  const present = new Set(allow ?? []);
  const missing = PERMISSION_RULES.filter((entry) => !present.has(entry.rule));
  return { status: missing.length === 0 ? 'ALREADY_PRESENT' : 'CONFLICT_EXISTING_FILE', missing, detail: '' };
}

function symbolicLinkLoopDetail(name) {
  return `${name} could not be inspected because of a symbolic link loop; Noah Kit does not follow it.`;
}

// Inspects .claude, then .claude/settings.json, with lstat, and reports a
// symbolic link at either path as a conflict instead of following it. Never
// writes.
// - .claude or settings.json missing: WILL_CREATE.
// - .claude is a symbolic link (to a directory, dangling, or a loop), .claude
//   is not a directory, settings.json is a symbolic link or not a regular
//   file, or lstat reports ELOOP: CONFLICT_INVALID_FILE.
// - settings.json is a regular file: read it and classify its content.
// The checks run once. A path replaced after its lstat is not re-checked.
export async function inspectSettings(root) {
  const directory = path.join(root, CLAUDE_DIRECTORY);
  const target = path.join(directory, SETTINGS_FILE);
  const willCreate = () => ({ status: 'WILL_CREATE', target, missing: [...PERMISSION_RULES], detail: '' });
  const invalid = (detail) => ({ status: 'CONFLICT_INVALID_FILE', target, missing: [], detail });

  let directoryStats;
  try {
    directoryStats = await lstat(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return willCreate();
    if (error.code === 'ELOOP') return invalid(symbolicLinkLoopDetail(CLAUDE_DIRECTORY));
    throw error;
  }
  if (directoryStats.isSymbolicLink()) {
    return invalid(`${CLAUDE_DIRECTORY} is a symbolic link; Noah Kit does not follow it.`);
  }
  if (!directoryStats.isDirectory()) {
    return invalid(`${CLAUDE_DIRECTORY} exists but is not a directory.`);
  }

  let stats;
  try {
    stats = await lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return willCreate();
    if (error.code === 'ENOTDIR') return invalid(`${CLAUDE_DIRECTORY} exists but is not a directory.`);
    if (error.code === 'ELOOP') return invalid(symbolicLinkLoopDetail(SETTINGS_DISPLAY_PATH));
    throw error;
  }
  if (stats.isSymbolicLink()) {
    return invalid(`${SETTINGS_DISPLAY_PATH} is a symbolic link; Noah Kit does not follow it.`);
  }
  if (!stats.isFile()) {
    return invalid(`${SETTINGS_DISPLAY_PATH} is not a regular file.`);
  }
  return { ...classifySettings(await readFile(target, 'utf8')), target };
}

function describeRules(entries) {
  return entries.map((entry) => `  - ${entry.rule}\n    Reason: ${entry.reason}`).join('\n');
}

// Every proposed rule with its reason, followed by the settings JSON that
// holds all of them. Ends with a newline.
function describeProposal() {
  return `Proposed rules:\n${describeRules(PERMISSION_RULES)}\nSettings JSON with every proposed rule:\n${formatSettings(createSettings())}`;
}

function describeConflict(inspection) {
  if (inspection.status === 'CONFLICT_INVALID_FILE') {
    return `CONFLICT_INVALID_FILE: ${inspection.detail}\nTarget: ${inspection.target}\n${describeProposal()}Noah Kit never modifies an existing settings file. Fix or remove the path yourself and run this command again, or add the rules to "permissions.allow" yourself, by hand or with /permissions in Claude Code.`;
  }
  return `CONFLICT_EXISTING_FILE: ${SETTINGS_DISPLAY_PATH} exists and does not list every proposed rule in permissions.allow.\nTarget: ${inspection.target}\nMissing from permissions.allow:\n${inspection.missing.map((entry) => `  - ${entry.rule}`).join('\n')}\n${describeProposal()}Noah Kit never modifies an existing settings file. Add the missing rules to "permissions.allow" yourself, by hand or with /permissions in Claude Code.`;
}

function describeAlreadyPresent(inspection) {
  return `ALREADY_PRESENT: ${SETTINGS_DISPLAY_PATH} already lists every proposed rule in permissions.allow.\nTarget: ${inspection.target}\n`;
}

// Text for the preview command. Never writes.
export function formatPreview(inspection) {
  const notes = `Notes:\n${PREVIEW_NOTES.map((note) => `  - ${note}`).join('\n')}\n`;
  if (inspection.status === 'WILL_CREATE') {
    return `WILL_CREATE: ${SETTINGS_DISPLAY_PATH} does not exist. Running this command with --apply would create it.\nTarget: ${inspection.target}\nProposed rules:\n${describeRules(PERMISSION_RULES)}\nExact content:\n${formatSettings(createSettings())}${notes}Preview only. Nothing was written.\n`;
  }
  if (inspection.status === 'ALREADY_PRESENT') {
    return `${describeAlreadyPresent(inspection)}Proposed rules:\n${describeRules(PERMISSION_RULES)}\n${notes}Nothing needs to change. Nothing was written.\n`;
  }
  return `${describeConflict(inspection)}\n${notes}Preview only. Nothing was written.\n`;
}

// Called after a write to a file this run created with 'wx' failed. Removes
// the path only while it still names that file (same device and inode as the
// handle reported); never removes anything else. Returns a sentence for the
// error message.
async function removeCreatedFile(target, created) {
  if (!created) {
    return 'Could not confirm that the path still names the file this run created, so it was not removed. Review it before retrying.';
  }
  try {
    const current = await lstat(target, { bigint: true });
    if (!current.isFile() || current.dev !== created.dev || current.ino !== created.ino) {
      return 'The path no longer names the file this run created, so it was not removed. Review it before retrying.';
    }
    await unlink(target);
    return 'Removed the incomplete file that this run created.';
  } catch (error) {
    if (error.code === 'ENOENT') return 'The file this run created no longer exists.';
    return `Could not remove the incomplete file that this run created (${error.message}). Remove it before retrying.`;
  }
}

// Creates the settings file only when inspectSettings returns WILL_CREATE,
// creating .claude first if it is missing. Conflicts throw an error that lists
// every proposed rule and says nothing was changed. The 'wx' open fails
// instead of replacing a settings.json that appears after the inspection,
// including a symbolic link at that path. .claude is not re-checked after the
// inspection. If the write fails after the open, removeCreatedFile removes
// only the file this run created, and the error says what happened to it.
export async function applyPermissions(root) {
  const inspection = await inspectSettings(root);
  if (inspection.status === 'ALREADY_PRESENT') {
    return { status: 'ALREADY_PRESENT', text: `${describeAlreadyPresent(inspection)}${PRECEDENCE_NOTE}\nNothing was written.\n` };
  }
  if (inspection.status !== 'WILL_CREATE') {
    throw new Error(`${describeConflict(inspection)}\nNothing was changed.`);
  }

  const { target } = inspection;
  const content = formatSettings(createSettings());
  let handle;
  try {
    await mkdir(path.dirname(target), { recursive: true });
    handle = await open(target, 'wx');
  } catch (error) {
    throw new Error(`Could not create ${target}. No existing file was overwritten. Review ${path.dirname(target)} before retrying. Original error: ${error.message}`);
  }

  let created;
  try {
    created = await handle.stat({ bigint: true });
    await handle.writeFile(content, 'utf8');
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {});
    const cleanup = await removeCreatedFile(target, created);
    throw new Error(`Could not write ${target}. ${cleanup} No existing file was overwritten. Original error: ${error.message}`);
  }
  return { status: 'CREATED', text: `CREATED: wrote ${SETTINGS_DISPLAY_PATH}.\nTarget: ${target}\nRules:\n${describeRules(PERMISSION_RULES)}\nExact content written:\n${content}Review and commit this file. It affects every collaborator after they trust the workspace.\nWhether Claude Code honors these rules has not been verified in a live session.\n` };
}
