import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const MANIFEST_PATH = path.join('.noah-kit', 'manifest.json');
const VERIFY_DIR = path.join('.noah-kit', 'verification');

async function readManifest(root) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(root, MANIFEST_PATH), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`No ${MANIFEST_PATH} found. Run noah init first.`);
    throw new Error(`Could not read ${MANIFEST_PATH}: ${error.message}`);
  }
  if (!manifest || manifest.schema_version !== 1 || manifest.kit?.id !== 'noah-kit') {
    throw new Error(`Invalid Noah Kit manifest: ${MANIFEST_PATH}`);
  }
  return manifest;
}

function getGitHead(root) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 3000 });
  if (result.status !== 0) throw new Error('Verification requires a Git repository with at least one commit.');
  return result.stdout.trim();
}

async function getFingerprint(root) {
  const head = getGitHead(root);
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: root, encoding: 'utf8', timeout: 5000
  });
  if (status.status !== 0) throw new Error('Could not inspect Git working tree before or after verification.');

  const paths = status.stdout.split('\n').filter(Boolean).map((line) => line.slice(3))
    .filter((file) => file !== VERIFY_DIR && !file.startsWith(VERIFY_DIR + path.sep))
    .map((file) => file.includes(' -> ') ? file.split(' -> ').at(-1) : file);
  const entries = [];
  for (const file of [...new Set(paths)].sort()) {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(path.resolve(root) + path.sep)) {
      throw new Error(`Git reported a path outside the project: ${file}`);
    }
    try {
      const content = await readFile(absolute);
      entries.push([file, createHash('sha256').update(content).digest('hex')]);
    } catch (error) {
      if (error.code === 'ENOENT') entries.push([file, 'DELETED']);
      else throw error;
    }
  }
  const canonical = JSON.stringify({ head, entries });
  return { head, entries, sha256: createHash('sha256').update(canonical).digest('hex') };
}

function validateCommands(commands) {
  if (!commands || typeof commands !== 'object' || Array.isArray(commands)) {
    throw new Error('Configure verification.commands in .noah-kit/manifest.json before running verification.');
  }
  for (const [name, command] of Object.entries(commands)) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(name) || !Array.isArray(command) || command.length === 0 ||
        command.some((part) => typeof part !== 'string' || !part.trim())) {
      throw new Error('verification.commands must map simple names to non-empty arrays of command arguments.');
    }
  }
  return commands;
}

export async function runVerification(root, name) {
  const manifest = await readManifest(root);
  const commands = validateCommands(manifest.verification?.commands);
  const selectedName = name ?? Object.keys(commands)[0];
  if (!selectedName || !Object.hasOwn(commands, selectedName)) {
    throw new Error(`Unknown verification command "${selectedName ?? ''}". Configured commands: ${Object.keys(commands).join(', ') || '(none)'}.`);
  }
  const command = commands[selectedName];
  const startedAt = new Date();
  const before = await getFingerprint(root);
  const result = spawnSync(command[0], command.slice(1), {
    cwd: root,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
    shell: process.platform === 'win32'
  });
  const output = [result.stdout ?? '', result.stderr ?? '', result.error ? `Runner error: ${result.error.message}\n` : ''].join('');
  const after = await getFingerprint(root);
  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  const stable = before.sha256 === after.sha256;
  const status = result.error ? 'FAILED_TO_START' : !stable ? 'INVALIDATED_DURING_RUN' : exitCode === 0 ? 'PASSED' : 'FAILED';
  const finishedAt = new Date();
  const record = {
    schema_version: 1,
    name: selectedName,
    command,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    exit_code: exitCode,
    status,
    head: after.head,
    fingerprint: after.sha256,
    changed_paths: after.entries.map(([file]) => file),
    output_bytes: Buffer.byteLength(output)
  };

  const directory = path.join(root, VERIFY_DIR);
  await mkdir(directory, { recursive: true });
  const safeName = selectedName.replace(/[^a-z0-9_-]/gi, '_');
  const stamp = finishedAt.toISOString().replace(/[:.]/g, '-');
  const logName = `${stamp}-${safeName}.log`;
  await writeFile(path.join(directory, logName), output, { flag: 'wx' });
  record.log = path.join(VERIFY_DIR, logName).split(path.sep).join('/');
  await writeFile(path.join(directory, 'latest.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  process.stdout.write(`Verification: ${status}\nCommand: ${command.join(' ')}\nExit code: ${exitCode}\nDuration: ${record.duration_ms} ms\nLog: ${record.log}\nFingerprint: ${record.fingerprint}\n`);
  if (status !== 'PASSED') process.stdout.write('This run does not provide a current passing verification result. Inspect the log and diagnose the cause before retrying.\n');
  return status === 'PASSED' ? 0 : 1;
}

export async function getCurrentVerificationStatus(root) {
  let record;
  try {
    record = JSON.parse(await readFile(path.join(root, VERIFY_DIR, 'latest.json'), 'utf8'));
  } catch {
    return { current: false, reason: 'No recorded verification result.' };
  }
  if (!record || record.schema_version !== 1 || typeof record.fingerprint !== 'string' || !record.log) {
    return { current: false, reason: 'The verification record is invalid.' };
  }
  try {
    const manifest = await readManifest(root);
    const commands = validateCommands(manifest.verification?.commands);
    if (!Object.hasOwn(commands, record.name) || JSON.stringify(commands[record.name]) !== JSON.stringify(record.command)) {
      return { current: false, reason: 'The configured verification command changed after the recorded run.' };
    }
    const current = await getFingerprint(root);
    if (current.sha256 !== record.fingerprint) {
      return { current: false, reason: 'The Git revision or changed-file contents differ from the recorded verification run.' };
    }
    const logPath = path.resolve(root, record.log);
    if (!logPath.startsWith(path.resolve(root, VERIFY_DIR) + path.sep)) {
      return { current: false, reason: 'The verification log path is outside the verification directory.' };
    }
    await readFile(logPath);
    if (record.status !== 'PASSED' || record.exit_code !== 0) {
      return { current: false, reason: `The last verification status is ${record.status}.` };
    }
    return { current: true, reason: 'The recorded passing result matches the current Git revision and changed-file contents.', record };
  } catch (error) {
    return { current: false, reason: error.message };
  }
}
