import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getNoahHome } from './local-state.js';

const MARKER = 'NOAH_KIT_MANAGED_LAUNCHER';

const dispatcher = `// ${MARKER}
import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const home = path.resolve(process.env.NOAH_HOME?.trim() || path.join(os.homedir(), '.noah-kit'));
const statePath = path.join(home, 'state.json');

async function exists(filePath) {
  try { await access(filePath); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

async function main() {
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('No Core installation found. Run: npx --yes github:w-vi-khang/noah-kit install');
    throw new Error('Cannot read Noah Kit local state: ' + error.message);
  }
  if (state.schema_version !== 1 || !state.installations || typeof state.installations !== 'object' || Array.isArray(state.installations)) {
    throw new Error('Noah Kit local state has an unsupported or invalid schema.');
  }
  const versions = Object.keys(state.installations).filter((version) => /^\\d+\\.\\d+\\.\\d+$/.test(version)).sort(compareVersions).reverse();
  for (const version of versions) {
    const installation = state.installations[version];
    if (!installation || installation.version !== version || typeof installation.path !== 'string') continue;
    const markerPath = path.join(installation.path, 'core-manifest.json');
    const cliPath = path.join(installation.path, 'src', 'cli.js');
    if (!(await exists(markerPath)) || !(await exists(cliPath))) continue;
    let marker;
    try { marker = JSON.parse(await readFile(markerPath, 'utf8')); } catch { continue; }
    if (marker.schema_version !== 1 || marker.package_name !== 'noah-kit' || marker.version !== version) continue;
    const module = await import(pathToFileURL(cliPath).href);
    if (typeof module.run !== 'function') throw new Error('Installed Core does not expose a supported CLI entry point.');
    process.exitCode = await module.run(process.argv.slice(2));
    return;
  }
  throw new Error('No valid Core installation found. Run: npx --yes github:w-vi-khang/noah-kit install');
}

main().catch((error) => { process.stderr.write('Noah launcher failed: ' + error.message + '\\n'); process.exitCode = 1; });
`;

const unixWrapper = `#!/bin/sh
# ${MARKER}
exec node "$(dirname "$0")/noah.js" "$@"
`;
const windowsWrapper = `@echo off
REM ${MARKER}
node "%~dp0noah.js" %*
exit /b %ERRORLEVEL%
`;

async function writeManagedFile(filePath, content, mode) {
  try {
    const existing = await readFile(filePath, 'utf8');
    if (!existing.includes(MARKER)) throw new Error('Refusing to overwrite an unmanaged file: ' + filePath);
    if (existing !== content) await writeFile(filePath, content, { mode });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(filePath, content, { flag: 'wx', mode });
  }
}

export async function createLaunchers(noahHome = getNoahHome()) {
  const binDirectory = path.join(noahHome, 'bin');
  await mkdir(binDirectory, { recursive: true });
  const dispatcherPath = path.join(binDirectory, 'noah.js');
  const unixLauncherPath = path.join(binDirectory, 'noah');
  const windowsLauncherPath = path.join(binDirectory, 'noah.cmd');
  await writeManagedFile(dispatcherPath, dispatcher, 0o600);
  if (os.platform() !== 'win32') {
    await writeManagedFile(unixLauncherPath, unixWrapper, 0o755);
    await chmod(unixLauncherPath, 0o755);
  }
  await writeManagedFile(windowsLauncherPath, windowsWrapper, 0o600);
  return { binDirectory, dispatcherPath, unixLauncherPath, windowsLauncherPath };
}
