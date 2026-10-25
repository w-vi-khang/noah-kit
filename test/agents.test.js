import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const agentsDirectory = path.join(repositoryRoot, '.claude', 'agents');
const mainAgentRule = readFileSync(path.join(repositoryRoot, '.claude', 'rules', 'main-agent.md'), 'utf8');

const MODELS = ['opus', 'sonnet', 'haiku', 'fable', 'inherit'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
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

test('each agent has a matching name, a description, an explicit tool list, and a valid model and effort', () => {
  for (const agent of agents) {
    assert.equal(agent.fields.name, path.basename(agent.fileName, '.md'), agent.fileName);
    assert.ok(agent.fields.description?.length > 20, `${agent.fileName} needs a description`);
    assert.ok(agent.tools.length > 0, `${agent.fileName} must list its tools explicitly instead of inheriting all tools`);
    assert.ok(MODELS.includes(agent.fields.model), `${agent.fileName} has an unsupported model`);
    assert.ok(EFFORTS.includes(agent.fields.effort), `${agent.fileName} has an unsupported effort`);
    assert.ok(agent.body.trim().length > 0, `${agent.fileName} needs instructions`);
  }
});

test('no agent can start other agents', () => {
  for (const agent of agents) {
    assert.equal(agent.tools.includes('Agent'), false, `${agent.fileName} must not have the Agent tool`);
    assert.equal(agent.tools.includes('Task'), false, `${agent.fileName} must not have the Task tool`);
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

test('subagents are told not to commit or push', () => {
  for (const agent of agents.filter((candidate) => !READ_ONLY_AGENTS.includes(candidate.fields.name))) {
    assert.match(agent.body, /MUST NOT commit, push/, agent.fileName);
  }
});

test('the main-agent rule assigns a stage to every agent', () => {
  for (const name of REQUIRED_AGENTS) {
    assert.ok(mainAgentRule.includes(`\`${name}\``), `main-agent rule must reference ${name}`);
  }
});

test('the project defaults the main agent to Opus 5.5 at high effort', () => {
  const settings = JSON.parse(readFileSync(path.join(repositoryRoot, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.model, 'claude-opus-5-5');
  assert.equal(settings.effortLevel, 'high');
});
