# Noah Kit

Noah Kit is a project-aware workflow kit for Claude Code. It is designed to keep reusable kit logic separate from project-specific configuration and user-local state.

## Foundational principles

- **English-only code:** All source code, identifiers, code comments, configuration keys, test names, commit messages, and technical documentation maintained as part of the kit must be written in English. User-facing explanations may use the user's preferred language.
- **Separation of concerns:** Keep reusable Core logic, committed project configuration, and user-local state separate.
- **Explicit installation:** A project can describe the required kit, but installing or updating executable Core components must be an explicit, reviewable action.
- **Safe updates:** Never overwrite uncommitted project changes. Validate versions and compatibility before applying updates.
- **Evidence-based verification:** Report checks as passed only when the corresponding command or check actually ran and its result was observed.
- **Least surprise:** No background behavior should be implied when Claude Code is not running. Scheduled checks happen on a later startup unless an optional external scheduler is explicitly configured.
- **Human control:** Declining installation is remembered locally, and users can install or update manually at any time.

## Quick start

Requirements: Node.js 20 or newer and network access to GitHub for the first invocation.

Initialize the current directory with one command:

```sh
npx --yes github:w-vi-khang/noah-kit init
```

To initialize a different directory:

```sh
npx --yes github:w-vi-khang/noah-kit init --cwd ../my-project
```

The command creates `.noah-kit/manifest.json` and `.claude/rules/noah-kit.md` only when they are missing. The dedicated rule lets Claude Code discover Noah Kit without replacing a project's existing `CLAUDE.md`. The command preserves existing files and rejects an invalid existing manifest. Review the generated files and commit them to the project repository.

**Current limitation:** this first milestone provides the initializer, not the persistent Core installer or update engine. It does not yet install Core skills, manage local state, check releases, or run migrations. Those features will be added only with explicit safety and recovery behavior.

## Initial implementation scope

The first milestone establishes the architecture, manifest contract, initialization behavior, and safety boundaries before adding automated updates, migrations, or multi-agent orchestration.

## Status

This repository is being initialized. The architecture and implementation plan are intentionally staged so that the first working path can be tested end-to-end before more features are added.
