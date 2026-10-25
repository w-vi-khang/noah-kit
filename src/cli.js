#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CLI_VERSION = '0.1.0';
const MANIFEST_PATH = path.join('.noah-kit', 'manifest.json');
const CLAUDE_RULE_PATH = path.join('.claude', 'rules', 'noah-kit.md');

function printHelp() {
  process.stdout.write(`Noah Kit ${CLI_VERSION}\n\nUsage:\n  noah init [--cwd <path>]\n  noah --version\n  noah --help\n\nCommands:\n  init       Initialize or validate Noah Kit project files\n\nOptions:\n  --cwd      Target project directory (defaults to the current directory)\n  --help     Show this help message\n  --version  Show the CLI version\n`);
}

function parseArguments(args) {
  const result = { command: null, cwd: process.cwd(), help: false, version: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--help' || argument === '-h') {
      result.help = true;
    } else if (argument === '--version' || argument === '-v') {
      result.version = true;
    } else if (argument === '--cwd') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Option --cwd requires a directory path.');
      }
      result.cwd = path.resolve(value);
      index += 1;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (result.command === null) {
      result.command = argument;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }

  return result;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('The Noah Kit manifest must contain a JSON object.');
  }
  if (manifest.schema_version !== 1) {
    throw new Error('Unsupported or missing schema_version. Expected 1.');
  }
  if (manifest.kit?.id !== 'noah-kit') {
    throw new Error('The manifest kit.id must be "noah-kit".');
  }
  if (typeof manifest.kit?.core_version_range !== 'string' || !manifest.kit.core_version_range.trim()) {
    throw new Error('The manifest must define kit.core_version_range.');
  }
  if (typeof manifest.project?.id !== 'string' || !manifest.project.id.trim() || manifest.project.id.startsWith('replace-')) {
    throw new Error('The manifest must define a stable project.id.');
  }
  if (typeof manifest.project?.name !== 'string' || !manifest.project.name.trim() || manifest.project.name.startsWith('replace-')) {
    throw new Error('The manifest must define project.name.');
  }
  if (typeof manifest.project?.type !== 'string' || !manifest.project.type.trim()) {
    throw new Error('The manifest must define project.type.');
  }
  return manifest;
}

async function loadProjectName(root) {
  const packagePath = path.join(root, 'package.json');
  if (await exists(packagePath)) {
    try {
      const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
      if (typeof packageJson.name === 'string' && packageJson.name.trim()) return packageJson.name.trim();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('The existing package.json is not valid JSON; fix it before initializing Noah Kit.');
      }
      throw error;
    }
  }
  return path.basename(root) || 'unnamed-project';
}

function createManifest(projectName) {
  return {
    schema_version: 1,
    kit: {
      id: 'noah-kit',
      core_version_range: '>=0.1.0 <0.2.0'
    },
    project: {
      id: randomUUID(),
      name: projectName,
      type: 'application'
    },
    installation: {
      prompt_on_missing_core: true,
      remember_declined_install_locally: true
    },
    updates: {
      check_on_startup: true,
      auto_install: false,
      check_after_local_time: '17:00',
      timezone: 'local',
      remind_after_days: 1,
      channel: 'stable'
    },
    capabilities: {
      skills: true,
      subagents: true,
      hooks: false,
      migrations: false
    }
  };
}

function createClaudeInstructions() {
  return `# Noah Kit Project Instructions\n\nThis project declares Noah Kit in \`.noah-kit/manifest.json\`. Read that manifest before applying Noah Kit workflows.\n\n## Mandatory rules\n\n- Write all code, identifiers, code comments, tests, configuration keys, and technical documentation in English.\n- Treat \`.noah-kit/manifest.json\` as committed project configuration, not as a place for user-local state or secrets.\n- Do not claim a test or verification passed unless it was actually run and its result was observed.\n- Preserve user changes. Do not overwrite conflicting files or run project scripts and migrations merely because they are referenced by configuration.\n- If Noah Kit Core is not installed, explain that Core installation is not available in this release. Do not silently download or execute code.\n\n## Project setup\n\nThe manifest is the source of project-specific Noah Kit settings. Keep reusable kit implementation outside this repository. Store installation choices, caches, logs, and update timestamps in user-local state outside version control.\n`;
}

async function initializeProject(root) {
  const manifestAbsolutePath = path.join(root, MANIFEST_PATH);
  const claudeRuleAbsolutePath = path.join(root, CLAUDE_RULE_PATH);
  const manifestExists = await exists(manifestAbsolutePath);
  const ruleExists = await exists(claudeRuleAbsolutePath);
  let manifest;
  let manifestContent;
  let ruleContent;

  if (manifestExists) {
    try {
      manifest = validateManifest(JSON.parse(await readFile(manifestAbsolutePath, 'utf8')));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`${MANIFEST_PATH} is not valid JSON; no files were changed.`);
      }
      throw new Error(`${MANIFEST_PATH} is invalid: ${error.message} No files were changed.`);
    }
  } else {
    manifest = createManifest(await loadProjectName(root));
    manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  }

  if (!ruleExists) {
    ruleContent = createClaudeInstructions();
  }

  const plannedChanges = [];
  if (!manifestExists) plannedChanges.push(MANIFEST_PATH);
  if (!ruleExists) plannedChanges.push(CLAUDE_RULE_PATH);

  if (plannedChanges.length === 0) {
    process.stdout.write(`No changes needed. Existing Noah Kit files were preserved.\nProject: ${manifest.project.name} (${manifest.project.id})\n`);
    return;
  }

  try {
    if (!manifestExists) {
      await mkdir(path.dirname(manifestAbsolutePath), { recursive: true });
      await writeFile(manifestAbsolutePath, manifestContent, { flag: 'wx' });
    }
    if (!ruleExists) {
      await mkdir(path.dirname(claudeRuleAbsolutePath), { recursive: true });
      await writeFile(claudeRuleAbsolutePath, ruleContent, { flag: 'wx' });
    }
  } catch (error) {
    throw new Error(`Initialization could not finish while creating ${error.path ?? 'a project file'}. Review the working tree before retrying. Original error: ${error.message}`);
  }

  process.stdout.write(`Initialized Noah Kit project files:\n${plannedChanges.map((item) => `  - ${item}`).join('\n')}\nProject: ${manifest.project.name} (${manifest.project.id})\nReview and commit these files. User-local state is not created in the project.\n`);
}

export async function run(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(args);
  } catch (error) {
    process.stderr.write(`${error.message}\nUse --help to see available commands.\n`);
    return 2;
  }

  if (options.help || options.command === 'help') {
    printHelp();
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }
  if (options.command !== 'init') {
    process.stderr.write('A command is required. Supported command: init.\nUse --help to see usage.\n');
    return 2;
  }

  try {
    await initializeProject(options.cwd);
    return 0;
  } catch (error) {
    process.stderr.write(`Noah Kit initialization failed: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`Unexpected error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
