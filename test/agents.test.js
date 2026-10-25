import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const agentsDirectory = path.join(repositoryRoot, '.claude', 'agents');
const mainAgentRule = readFileSync(path.join(repositoryRoot, '.claude', 'rules', 'main-agent.md'), 'utf8');

const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
const READ_ONLY_AGENTS = ['planner', 'reviewer', 'verifier'];
const REQUIRED_AGENTS = ['planner', 'implementer', 'test-engineer', 'reviewer', 'verifier'];

// Parses the flat "key: value" frontmatter used by the agent files.
function readAgent(fileName) {
  const content = readFileSync(path.join(agentsDirectory, fileName), 'utf8').replace(/\r\n/g, '\n');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, `${fileName} must start with YAML frontmatter`);
  const fields = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    assert.ok(separator > 0, `${fileName} has an unsupported frontmatter line: ${line}`);
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { fileName, fields, body: match[2], tools: (fields.tools ?? '').split(',').map((tool) => tool.trim()).filter(Boolean) };
}

const agents = readdirSync(agentsDirectory).filter((name) => name.endsWith('.md')).map(readAgent);

test('defines every agent the main-agent rule depends on', () => {
  assert.deepEqual(agents.map((agent) => agent.fields.name).sort(), [...REQUIRED_AGENTS].sort());
});

test('each agent has a matching name, a description, an explicit tool list, and instructions', () => {
  for (const agent of agents) {
    assert.equal(agent.fields.name, path.basename(agent.fileName, '.md'), agent.fileName);
    assert.ok(agent.fields.description?.length > 20, `${agent.fileName} needs a description`);
    assert.ok(agent.tools.length > 0, `${agent.fileName} must list its tools explicitly instead of inheriting all tools`);
    assert.ok(agent.body.trim().length > 0, `${agent.fileName} needs instructions`);
  }
});

test('no agent fixes a model or effort, so the main agent chooses them per request', () => {
  for (const agent of agents) {
    assert.equal('model' in agent.fields, false, `${agent.fileName} must not set model`);
    assert.equal('effort' in agent.fields, false, `${agent.fileName} must not set effort`);
  }
  const guide = mainAgentRule.split('## Model and effort')[1]?.split('\n## ')[0] ?? '';
  assert.match(guide, /MUST set `model` explicitly, MUST set `effort` explicitly when the Agent tool accepts it/);
  for (const model of ['haiku', 'sonnet', 'opus']) {
    assert.match(guide, new RegExp(`\`${model}\``), `model guide must cover ${model}`);
  }
});

test('the main agent must not push without a request in the current turn', () => {
  assert.match(mainAgentRule, /MUST NOT push to any remote branch, including `main`, unless the user asked for that push in the current request/);
});

test('no agent can start other agents', () => {
  for (const agent of agents) {
    for (const tool of agent.tools) {
      assert.doesNotMatch(tool, /^(Agent|Task)\b/, `${agent.fileName} must not have the ${tool} tool`);
    }
  }
});

test('planning, review, and verification agents cannot edit files', () => {
  for (const name of READ_ONLY_AGENTS) {
    const agent = agents.find((candidate) => candidate.fields.name === name);
    for (const tool of WRITE_TOOLS) {
      assert.equal(agent.tools.includes(tool), false, `${name} must not have ${tool}`);
    }
    assert.match(agent.body, /MUST NOT create, edit, or delete files/);
  }
});

test('every subagent is told not to commit, push, or change branches', () => {
  for (const agent of agents) {
    assert.match(agent.body, /MUST NOT [^.]*commit, push, or change branches/, agent.fileName);
  }
});

test('the main-agent stage table assigns a stage to every agent', () => {
  const section = mainAgentRule.split('## Stages per tier')[1]?.split('\n## ')[0] ?? '';
  const tableRows = section.split('\n').filter((line) => line.startsWith('|'));
  assert.ok(tableRows.length > 2, 'main-agent rule must contain a stage table');
  for (const name of REQUIRED_AGENTS) {
    assert.ok(tableRows.some((row) => row.includes(`\`${name}\``)), `stage table must assign ${name}`);
  }
});

test('the project defaults the main agent to Opus 5.5 at high effort', () => {
  const settings = JSON.parse(readFileSync(path.join(repositoryRoot, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.model, 'claude-opus-5-5');
  assert.equal(settings.effortLevel, 'high');
});
