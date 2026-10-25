import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const STATE_SCHEMA_VERSION = 1;
const STATE_FILE_NAME = 'state.json';

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
  return state;
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
      await import('node:fs/promises').then(({ rm }) => rm(temporaryPath, { force: true }));
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
