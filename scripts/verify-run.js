#!/usr/bin/env node
import { runVerification } from '../src/verification.js';

function parse(args) {
  const options = { cwd: process.cwd(), name: undefined };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--cwd') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--cwd requires a project path.');
      options.cwd = value;
      index += 1;
    } else if (args[index] === '--name') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--name requires a configured command name.');
      options.name = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${args[index]}`);
    }
  }
  return options;
}

try {
  const options = parse(process.argv.slice(2));
  process.exitCode = await runVerification(options.cwd, options.name);
} catch (error) {
  process.stderr.write(`Verification runner failed: ${error.message}\n`);
  process.exitCode = 1;
}
