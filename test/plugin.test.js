import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const readJson = (relativePath) => JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), 'utf8'));

const packageJson = readJson('package.json');
const plugin = readJson('.claude-plugin/plugin.json');
const marketplace = readJson('.claude-plugin/marketplace.json');

test('the plugin and the CLI share one name and version', () => {
  assert.equal(plugin.name, 'noah-kit');
  assert.equal(plugin.version, packageJson.version);
});

test('the marketplace lists the plugin from the repository root', () => {
  assert.equal(marketplace.name, 'noah-kit');
  assert.equal(marketplace.owner?.name?.length > 0, true);
  assert.deepEqual(marketplace.plugins.map((entry) => [entry.name, entry.source]), [['noah-kit', './']]);
  assert.equal('version' in marketplace.plugins[0], false, 'plugin.json is the only source of the plugin version');
});

test('the plugin ships every project agent and nothing outside the repository', () => {
  const projectAgents = readdirSync(path.join(repositoryRoot, '.claude', 'agents'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `./.claude/agents/${name}`)
    .sort();
  assert.deepEqual([...plugin.agents].sort(), projectAgents);
  for (const agentPath of plugin.agents) {
    assert.ok(agentPath.startsWith('./') && !agentPath.includes('..'), `${agentPath} must stay inside the plugin root`);
    assert.ok(existsSync(path.join(repositoryRoot, agentPath)), `${agentPath} must exist`);
  }
});

test('bin/noah is an LF-terminated executable that runs the bundled CLI', (t) => {
  const launcherPath = path.join(repositoryRoot, 'bin', 'noah');
  const content = readFileSync(launcherPath, 'utf8');
  assert.match(content, /^#!\/bin\/sh\n/);
  assert.equal(content.includes('\r'), false, 'bin/noah must use LF line endings');
  assert.match(readFileSync(path.join(repositoryRoot, '.gitattributes'), 'utf8'), /^bin\/noah text eol=lf$/m);

  if (process.platform === 'win32') {
    t.skip('POSIX launcher execution is not tested on Windows.');
    return;
  }
  assert.ok((statSync(launcherPath).mode & 0o111) !== 0, 'bin/noah must be executable');
  const result = spawnSync(launcherPath, ['--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), packageJson.version);
});

test('bin/noah runs from a copy of the git-tracked files only, with git-recorded modes', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX launcher execution is not tested on Windows.');
    return;
  }
  // A git-hosted marketplace installs the plugin from a clone, so untracked
  // files and on-disk modes that git did not record are not available there.
  const listing = spawnSync('git', ['ls-files', '-s', '-z'], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  const copyRoot = mkdtempSync(path.join(os.tmpdir(), 'noah-plugin-copy-'));
  try {
    for (const entry of listing.stdout.split('\0').filter(Boolean)) {
      const [metadata, relativePath] = entry.split('\t');
      const mode = metadata.split(' ')[0];
      const target = path.join(copyRoot, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(repositoryRoot, relativePath), target);
      chmodSync(target, mode === '100755' ? 0o755 : 0o644);
    }
    const result = spawnSync(path.join(copyRoot, 'bin', 'noah'), ['--version'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.equal(result.stdout.trim(), packageJson.version);
  } finally {
    rmSync(copyRoot, { recursive: true, force: true });
  }
});
