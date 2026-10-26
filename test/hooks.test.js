import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const plugin = JSON.parse(readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
const hookConfig = JSON.parse(readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'));
const gatePath = path.join(root, 'scripts', 'stop-gate.js');
const skillNames = ['workflow-orchestration', 'failure-diagnosis', 'efficient-verification'];

function runGate(cwd, stopHookActive = false) {
  return spawnSync(process.execPath, [gatePath], {
    cwd,
    input: JSON.stringify({ cwd, stop_hook_active: stopHookActive }),
    encoding: 'utf8',
    timeout: 5000
  });
}

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('plugin registers its skills and Stop hook using component paths', () => {
  assert.equal(plugin.skills, './skills/');
  assert.equal(plugin.hooks, './hooks/hooks.json');
  assert.ok(hookConfig.hooks.Stop?.length > 0);
  assert.match(hookConfig.hooks.Stop[0].hooks[0].command, /scripts\/stop-gate\.js/);

  for (const name of skillNames) {
    const skillPath = path.join(root, 'skills', name, 'SKILL.md');
    const skill = readFileSync(skillPath, 'utf8').replace(/\r\n/g, '\n');
    assert.match(skill, new RegExp('^---\\nname: ' + name + '\\n'));
    assert.ok(skill.length > 200, name + ' must contain actionable guidance');
  }
});

test('Stop hook requests evidence when a Git working tree is dirty', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'noah-stop-gate-'));
  try {
    git(cwd, 'init');
    git(cwd, 'config', 'user.email', 'noah-test@example.invalid');
    git(cwd, 'config', 'user.name', 'Noah Kit Test');
    writeFileSync(path.join(cwd, 'sample.js'), 'export const value = 1;\n');
    git(cwd, 'add', 'sample.js');
    git(cwd, 'commit', '-m', 'Initial fixture');
    writeFileSync(path.join(cwd, 'sample.js'), 'export const value = 2;\n');

    const result = runGate(cwd);
    assert.equal(result.status, 0, result.stderr);
    const response = JSON.parse(result.stdout);
    assert.equal(response.decision, 'block');
    assert.match(response.reason, /verification evidence/);
    assert.match(response.reason, /sample\.js/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Stop hook avoids repeated blocking after Claude has already continued once', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'noah-stop-gate-repeat-'));
  try {
    git(cwd, 'init');
    git(cwd, 'config', 'user.email', 'noah-test@example.invalid');
    git(cwd, 'config', 'user.name', 'Noah Kit Test');
    writeFileSync(path.join(cwd, 'sample.js'), 'export const value = 1;\n');
    git(cwd, 'add', 'sample.js');
    git(cwd, 'commit', '-m', 'Initial fixture');
    writeFileSync(path.join(cwd, 'sample.js'), 'export const value = 2;\n');

    const result = runGate(cwd, true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Stop hook fails open outside a Git repository', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'noah-stop-gate-no-git-'));
  try {
    mkdirSync(path.join(cwd, 'nested'));
    const result = runGate(cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
