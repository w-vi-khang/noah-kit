import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isCanonicalLanguageTag } from './preferences.js';
import { isIsoTimestamp } from './timestamp.js';

const STATE_SCHEMA_VERSION = 1;
const STATE_FILE_NAME = 'state.json';
export const UPDATE_CHECK_RESULTS = ['UP_TO_DATE', 'UPDATE_AVAILABLE', 'FAILED'];

export function getNoahHome(environment = process.env, homeDirectory = os.homedir()) {
  const configuredHome = environment.NOAH_HOME;
  return path.resolve(configuredHome && configuredHome.trim() ? configuredHome : path.join(homeDirectory, '.noah-kit'));
}

export function getStatePath(noahHome) {
  return path.join(noahHome, STATE_FILE_NAME);
}

function createEmptyState() {
  return {
    schema_version: STATE_SCHEMA_VERSION,
    installations: {},
    projects: {}
  };
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Local state must be a JSON object.');
  }
  if (state.schema_version !== STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported local state schema version. Expected ${STATE_SCHEMA_VERSION}.`);
  }
  if (!state.installations || typeof state.installations !== 'object' || Array.isArray(state.installations)) {
    throw new Error('Local state installations must be an object.');
  }
  if (!state.projects || typeof state.projects !== 'object' || Array.isArray(state.projects)) {
    throw new Error('Local state projects must be an object.');
  }
  for (const [version, installation] of Object.entries(state.installations)) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || !installation || typeof installation !== 'object' || Array.isArray(installation)) {
      throw new Error('Local state contains an invalid Core installation entry.');
    }
    if (installation.version !== version || typeof installation.path !== 'string' || !installation.path.trim()) {
      throw new Error(`Local state installation ${version} must contain a matching version and a non-empty path.`);
    }
  }
  for (const [projectId, project] of Object.entries(state.projects)) {
    if (!projectId.trim() || !project || typeof project !== 'object' || Array.isArray(project)) {
      throw new Error('Local state contains an invalid project entry.');
    }
  }
  if (state.update_checks !== undefined) {
    validateUpdateChecks(state.update_checks);
  }
  if (state.preferences !== undefined) {
    validatePreferences(state.preferences);
  }
  return state;
}

// preferences holds personal settings that must not be committed to a
// project, such as the language Claude Code uses to talk to this user.
function validatePreferences(preferences) {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    throw new Error('Local state preferences must be an object.');
  }
  if (preferences.communication_language !== undefined && !isCanonicalLanguageTag(preferences.communication_language)) {
    throw new Error('Local state preferences.communication_language must be a canonical BCP 47 language tag such as "vi".');
  }
}

// update_checks is optional so state written before release checks existed
// remains valid without a schema migration.
function validateUpdateChecks(updateChecks) {
  if (!updateChecks || typeof updateChecks !== 'object' || Array.isArray(updateChecks)) {
    throw new Error('Local state update_checks must be an object.');
  }
  for (const [channel, record] of Object.entries(updateChecks)) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(channel) || !record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('Local state contains an invalid update check entry.');
    }
    for (const field of ['last_attempt_at', 'last_success_at']) {
      if (record[field] !== undefined && !isIsoTimestamp(record[field])) {
        throw new Error(`Local state update check ${channel}.${field} must be an ISO 8601 timestamp.`);
      }
    }
    if (record.last_result !== undefined && !UPDATE_CHECK_RESULTS.includes(record.last_result)) {
      throw new Error(`Local state update check ${channel}.last_result is not supported.`);
    }
    if (record.latest_known_version !== undefined && record.latest_known_version !== null && !/^\d+\.\d+\.\d+$/.test(record.latest_known_version)) {
      throw new Error(`Local state update check ${channel}.latest_known_version must be a stable version or null.`);
    }
  }
}

export async function loadLocalState(noahHome) {
  const statePath = getStatePath(noahHome);
  try {
    const content = await readFile(statePath, 'utf8');
    let state;
    try {
      state = JSON.parse(content);
    } catch {
      throw new Error(`Local state at ${statePath} is invalid JSON. It was preserved; repair or back it up before retrying.`);
    }
    return validateState(state);
  } catch (error) {
    if (error.code === 'ENOENT') return createEmptyState();
    throw error;
  }
}

export async function saveLocalState(noahHome, state) {
  validateState(state);
  await mkdir(noahHome, { recursive: true });
  const statePath = getStatePath(noahHome);
  const temporaryPath = path.join(noahHome, `.state.${process.pid}.${randomUUID()}.tmp`);
  const content = `${JSON.stringify(state, null, 2)}\n`;

  try {
    await writeFile(temporaryPath, content, { flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, statePath);
  } catch (error) {
    try {
      await rm(temporaryPath, { force: true });
    } catch {
      // Preserve the original write error.
    }
    throw new Error(`Could not safely write local state: ${error.message}`);
  }
}

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
