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

The command creates `.noah-kit/manifest.json` and `.claude/rules/noah-kit.md` only when they are missing, installs the three workflow skills under `.claude/skills/`, copies the verification runner and Stop-hook runtime into `.noah-kit/runtime/`, and merges the Noah Kit Stop hook into `.claude/settings.local.json`. The dedicated rule lets Claude Code discover Noah Kit without replacing a project's existing `CLAUDE.md`. Existing skill/runtime files are preserved; existing valid local settings are merged without removing unrelated settings or hooks. Invalid local settings are not overwritten. The hook registration is kept in local settings so `init` does not alter shared project settings. Review the generated files and commit the project-level files deliberately. `.claude/settings.local.json` is developer-local and should not be committed.

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

This stores the decision and reminder interval in local state. Automatic startup prompting is not implemented yet.

Set the language Claude Code uses to talk to you, for example Vietnamese:

```sh
npx --yes github:w-vi-khang/noah-kit language vi
```

The preference is a BCP 47 tag (`vi`, `en`, `pt-BR`) stored in user-local state, not in the project, so each developer can choose their own. It applies to conversation only; code and technical artifacts stay in English. Run `language` without a tag to show the current setting, or `language clear` to remove it. The generated Claude Code rule tells Claude to read this setting. That is an instruction, not an enforced hook, and projects initialized before this rule existed keep their old rule file until it is updated by hand.

Preview the Claude Code permission rules Noah Kit proposes for this project:

```sh
npx --yes github:w-vi-khang/noah-kit permissions
```

The preview writes nothing. It reports one of `WILL_CREATE`, `ALREADY_PRESENT`, `CONFLICT_EXISTING_FILE`, or `CONFLICT_INVALID_FILE`, then lists each proposed rule with its reason. Except for `ALREADY_PRESENT`, it also prints the settings JSON. The rules are read-only `Read` permissions for `~/.noah-kit/state.json` and `~/.noah-kit/versions/**`, which the generated rule's Core installation check reads at session start. `src/claude-permissions.js` holds the authoritative list. To create the file, add `--apply`:

```sh
npx --yes github:w-vi-khang/noah-kit permissions --apply
```

`--apply` creates `.claude/settings.json` only when no settings file exists. It never modifies an existing file: when the file exists and lacks a rule, the command exits with status 1, changes nothing, and prints the missing rules, every proposed rule with its reason, and the settings JSON to add by hand or with `/permissions`. A symbolic link at `.claude` or `.claude/settings.json`, a `.claude` that is not a directory, a settings path that is not a regular file, and invalid settings content are also conflicts; the command does not follow symbolic links. `docs/architecture.md` describes the conflict handling. The command does not read `.claude/settings.local.json` or user settings, does not cover a `NOAH_HOME` override, and requires an initialized project. `init` may create or update `.claude/settings.local.json` to register the Noah Kit Stop hook when `capabilities.hooks` is enabled in the manifest. It does not modify shared `.claude/settings.json`. The `permissions` command remains separate and create-only; it never modifies an existing settings file. A committed settings file affects every collaborator once they trust the workspace, so review and commit it deliberately. The tests check the CLI, not whether Claude Code honors the rules; that has not been verified in a live session.

The Claude Code plugin provides workflow-orchestration, failure-diagnosis, and efficient-verification skills, plus a Stop hook that prompts for diff inspection and evidence-based reporting when the working tree is dirty. `noah init` also installs these skills and a project-local copy of the hook/runtime into the generated adapter, controlled by `capabilities.skills` and `capabilities.hooks`. The hook is a reminder only; it does not run tests or prove correctness.

For projects that configure checks in `.noah-kit/manifest.json`, `noah init` installs the verification runner at `.noah-kit/runtime/scripts/verify-run.js`. Configure explicit argument arrays under `verification.commands`, then run `node .noah-kit/runtime/scripts/verify-run.js --cwd . --name <command-name>`. It stores full logs and source fingerprints in `.noah-kit/verification/`; the Stop hook treats missing or stale evidence as unverified. The runner never guesses which project command to execute.

Try Core as a Claude Code plugin (see `docs/agent-workflow.md`). For one session:

```sh
claude --plugin-dir /path/to/noah-kit
```

To install it from a local clone:

```sh
claude plugin marketplace add /path/to/noah-kit
claude plugin install noah-kit@noah-kit
```

The plugin provides the five workflow subagents as `noah-kit:<name>` and puts `noah` on the `PATH` of Claude's Bash tool (POSIX shells only). A `noah` already on your `PATH` takes precedence; check with `noah --version`. The subagents refer to the main-agent tiers in `.claude/rules/main-agent.md`, which the plugin does not ship yet, so they are intended for this repository for now. Loading the plugin in a live session has not been verified yet.

Check whether a newer compatible Core release has been published:

```sh
npx --yes github:w-vi-khang/noah-kit update-check
```

The command reads the release index (`releases.json`), compares it with the local Core and the project's version range, and records the result in local state. It respects the project's check schedule (`updates.check_after_local_time`, default `17:00`) and reports `CHECK_NOT_DUE` when no check is due; `--force` checks immediately. It reports only and never downloads or installs a release. Nothing invokes it in the background: the schedule is evaluated only when the command runs. See `docs/releases.md` for the index format, trust model, and limitations.

The default local data directory is `~/.noah-kit/` (with the home-directory equivalent on Windows). It stores versioned Core files and `state.json`; it is not part of the project repository. Set `NOAH_HOME` only when you intentionally want to use a different local data directory. The installer copies a fixed set of files and does not run package lifecycle scripts or project migrations.

**Current limitations:** the CLI supports project initialization, local Core installation, status inspection, declined-install recording, onboarding decisions, local launcher generation, on-demand release checks, and a previewed, create-only Claude Code permission settings file. The launcher does not modify `PATH` or shell configuration. `permissions --apply` creates a missing `.claude/settings.json` but cannot merge rules into an existing one. Noah Kit does not yet perform automatic startup onboarding or scheduled background checks, install or update Core from a published release, verify signed release metadata, run migrations, or install the plugin's subagents into each project's generated adapter. Workflow skills and the Stop hook are installed by `noah init`; the five specialist subagents remain plugin-only.

## Initial implementation scope

The current foundation includes the architecture contract, cross-platform initializer, versioned local Core installation, schema-validated local state, project/Core compatibility checks, and explicit recording of declined installation choices, and a report-only release check against a validated release index. Automated onboarding, release installation and updates, migrations, and multi-agent orchestration remain future milestones.

## Status

The repository is in active early development. See `docs/implementation-plan.md` for implemented milestones, outstanding work, and acceptance criteria.
