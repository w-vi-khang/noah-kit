#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

let input = '';
for await (const chunk of process.stdin) input += chunk;

let hookInput = {};
try {
  hookInput = input.trim() ? JSON.parse(input) : {};
} catch {
  // Malformed hook input must not trap the user in a stop-hook loop.
  process.exit(0);
}

if (hookInput.stop_hook_active === true) process.exit(0);

const cwd = typeof hookInput.cwd === 'string' ? hookInput.cwd : process.cwd();
const result = spawnSync('git', ['status', '--short'], {
  cwd,
  encoding: 'utf8',
  timeout: 2500,
  windowsHide: true
});

if (result.error || result.status !== 0) process.exit(0);

const changed = result.stdout.trim();
if (!changed) process.exit(0);

// This is a single reminder, not proof of verification. On the next stop event,
// stop_hook_active prevents repeated blocking if the working tree is still dirty.
process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: [
    'Noah Kit: before finishing, inspect the current diff and report verification evidence.',
    'Run the narrowest relevant project check if one is documented and safe.',
    'Do not rerun an unchanged failure without a diagnostic reason.',
    'If verification cannot be completed, explicitly report UNVERIFIED or PENDING and why.',
    'Changed working-tree paths were detected; this hook does not infer whether they are correct.',
    changed
  ].join('\n')
}));
