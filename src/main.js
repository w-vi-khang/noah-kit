#!/usr/bin/env node

// Entry adapter for every command-line invocation (npx, bin/noah, tests).
// src/cli.js stays a side-effect-free module, so how this file is reached
// (directly, through a symlinked npm bin link, or from a plugin cache) does
// not affect whether the CLI runs.
import process from 'node:process';
import { run } from './cli.js';

run(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error) => {
  process.stderr.write(`Unexpected error: ${error.message}\n`);
  process.exitCode = 1;
});
