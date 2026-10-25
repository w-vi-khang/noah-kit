# Noah Kit Development Instructions

Read `README.md`, `CONTRIBUTING.md`, `docs/architecture.md`, and `docs/implementation-plan.md` before making architectural changes.

## Mandatory language rule

Write all code in English. This includes source code, identifiers, code comments, configuration keys and human-readable configuration values, tests, fixtures, commit messages, technical documentation, skills, agent instructions, and generated project instructions. Preserve protocol-defined values and external user content when changing them would alter behavior. Stakeholder conversations may use the stakeholder's preferred language.

## Repository safety rules

- Keep reusable Core logic, committed project configuration, and user-local state separate.
- Treat `.noah-kit/manifest.json` as project configuration. Never put credentials, machine-specific paths, declined-install state, caches, or update timestamps in it.
- Do not add update automation, executable hooks, or migration execution until their safety contracts and tests are implemented.
- Never silently overwrite user-authored files. Initialization must preflight conflicts and preserve existing content.
- Do not claim tests passed unless they were actually run and their output was observed.
- A successful command is not sufficient if acceptance criteria are not met; verify the behavior and scope explicitly.
- Keep changes small and end-to-end testable. Add tests for behavior changes.
- Before introducing subagents, define task ownership, expected outputs, acceptance criteria, and how results will be verified.

## Current implementation boundary

The CLI currently supports `init`, `install`, `status`, `decline`, `onboarding`, and `link`. It can install the current Core version into user-local versioned storage, validate the project's supported Core version-range syntax, preserve local state, record declined-install choices, and report whether onboarding should be offered, and create a user-local launcher without modifying shell configuration.

Automatic startup prompting, scheduled release checks, remote release-integrity verification, Core update/rollback transactions, migration execution, executable Claude Code lifecycle hooks, skills, and multi-agent orchestration are not implemented or verified yet. Do not imply otherwise.
