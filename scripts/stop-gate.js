#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getCurrentVerificationStatus } from '../src/verification.js';

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
const latestPath = path.join(cwd, '.noah-kit', 'verification', 'latest.json');
let hasVerificationRecord = false;
try {
  await access(latestPath);
  hasVerificationRecord = true;
} catch {
  // No prior run is normal on a new project.
}

let verification = { current: false, reason: 'No recorded verification result.' };
try {
  verification = await getCurrentVerificationStatus(cwd);
} catch {
  // The hook must fail open on unexpected inspection errors.
}

if (verification.current) process.exit(0);
if (!changed && !hasVerificationRecord) process.exit(0);

// This hook blocks once per stop cycle. It never runs a project command itself.
process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: [
    'Noah Kit: inspect the diff and report verification evidence before finishing.',
    'Run the narrowest configured verification command with: node .noah-kit/runtime/scripts/verify-run.js --cwd . [--name <command>].',
    'Do not rerun an unchanged failure without a diagnostic reason.',
    'If verification cannot be completed, explicitly report UNVERIFIED or PENDING and why.',
    hasVerificationRecord ? `Recorded verification is not current: ${verification.reason}` : 'No verification run has been recorded for the current changes.',
    changed || 'The working tree is clean, but a previous verification record is stale.'
  ].join('\n')
}));
