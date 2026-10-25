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

Install the current Core version into user-local storage after reviewing the command:

```sh
npx --yes github:w-vi-khang/noah-kit install
```

Create user-local launchers after installing Core:

```sh
npx --yes github:w-vi-khang/noah-kit link
```

This creates a launcher in the local Noah Kit bin directory. Add that directory to your PATH manually if desired; Noah Kit does not change shell configuration. The launcher dispatches to the newest valid Core installation.

Inspect the local installation and the current project registration:

```sh
npx --yes github:w-vi-khang/noah-kit status
```

Check the onboarding decision without installing Core:

```sh
npx --yes github:w-vi-khang/noah-kit onboarding
```

The command reports one of `NO_KIT_PROJECT`, `CORE_READY`, `INSTALL_DECLINED`, `PROMPT_INSTALL`, or `NO_COMPATIBLE_RELEASE`. It does not install Core or run a background scheduler.

If you decline installation for a project, record that decision locally:

```sh
npx --yes github:w-vi-khang/noah-kit decline
```

This stores the decision and reminder interval in local state. Automatic startup prompting and scheduled update checks are not implemented yet.

The default local data directory is `~/.noah-kit/` (with the home-directory equivalent on Windows). It stores versioned Core files and `state.json`; it is not part of the project repository. Set `NOAH_HOME` only when you intentionally want to use a different local data directory. The installer copies a fixed set of files and does not run package lifecycle scripts or project migrations.

**Current limitations:** the CLI currently supports project initialization, local Core installation, status inspection, and recording a declined-install choice. It does not yet perform automatic startup onboarding, evaluate reminder deadlines, check for new releases, update an installed Core, verify signed release artifacts, run migrations, or install skills and agent workflows. These capabilities remain disabled until their safety and recovery behavior is implemented.

## Initial implementation scope

The current foundation includes the architecture contract, cross-platform initializer, versioned local Core installation, schema-validated local state, project/Core compatibility checks, and explicit recording of declined installation choices. Automated onboarding, release updates, migrations, and multi-agent orchestration remain future milestones.

## Status

The repository is in active early development. See `docs/implementation-plan.md` for implemented milestones, outstanding work, and acceptance criteria.
