# Noah Kit Architecture

## Goals

Noah Kit provides reusable workflow behavior for Claude Code while allowing each repository to own its project-specific rules and each developer to keep personal state private and local.

## Three data domains

### 1. Core

Core is installed outside the target project and contains reusable runtime code, versioned templates, built-in rules, skills, update logic, and migration tooling. Core installation and update operations must be explicit and must validate source metadata before activation. The installer copies the package manifest, Core source directory, workflow skills, hook/verification scripts, and optional documentation into a versioned local directory; it validates the project's declared Core version range using a deliberately limited syntax of exact versions and space-separated comparison operators, and it does not run package lifecycle scripts or project migrations. Artifact signatures and remote release integrity checks remain future work.

### 2. Project configuration

Project configuration lives in a committed, dedicated directory such as `.noah-kit/`. It describes the project identity, compatible Core range, enabled capabilities, project-specific rules, and migration declarations. It must not contain personal preferences, private machine paths, credentials, or mutable runtime state.

### 3. Local state

Local state lives outside the project repository, under `~/.noah-kit/` by default (or `NOAH_HOME` when explicitly overridden). The schema stores installed Core versions, project identity mappings, declined-install decisions, per-channel release-check records (`update_checks`), and personal preferences such as the conversation language (`preferences.communication_language`). Caches, backups, and operation logs are planned additions. State writes use a temporary file and rename, and invalid state is preserved with an actionable error rather than silently reset. Local state must never be committed to the project.

## Claude Code adapter

The adapter should be thin and generated or maintained by Noah Kit. It exposes the minimum instructions and hooks needed for Claude Code to discover the project configuration and invoke supported behavior. It must not copy the entire Core into the repository.

The adapter must not assume symbolic links behave identically on Windows, macOS, and Linux. Prefer explicit generated files or a tested platform-specific linking strategy.

Project permission rules are written only by the explicit command `noah permissions --apply`, never by `init`, and never into an existing `.claude/settings.json`. `src/claude-permissions.js` is the authoritative list of the proposed rules, the reason for each, and the classification of existing paths. The rules are read-only access to the local state and Core installation paths that the generated rule's Core installation check reads. Whether Claude Code honors them is not verified in a live session.

- The command inspects `.claude`, then `.claude/settings.json`, with `lstat`. It does not follow a symbolic link at either path.
- `CONFLICT_INVALID_FILE`: either path is a symbolic link (to a directory, dangling, or a loop), `lstat` reports a symbolic link loop, `.claude` is not a directory, `settings.json` is not a regular file, or its content is not a usable settings object.
- `CONFLICT_EXISTING_FILE`: `settings.json` is usable but its `permissions.allow` lacks a proposed rule.
- On either conflict, the preview exits with status 0 and `--apply` exits with status 1. Both write nothing and print every proposed rule, its reason, and the settings JSON for the user to add.
- When `settings.json` is missing, `--apply` creates `.claude` if needed, then creates the file with an exclusive create, which fails instead of replacing a `settings.json` that appears after the inspection. `.claude` is not re-checked after the inspection.
- If the write fails after the exclusive create, the command removes the file only while the path still names the file it created, and its error says whether the file was removed.

Current direction: reusable plugin components (subagents and the `noah` executable) remain available through the plugin. `noah init` also installs workflow skills and a project-local copy of the Stop-hook runtime into the adapter, so those workflows can work without requiring the plugin to be enabled. The hook registration is kept in `.claude/settings.local.json` to avoid modifying shared project settings.

## Workflow skills and lifecycle hooks

The Claude Code plugin registers reusable skills under `skills/` and lifecycle hooks through `hooks/hooks.json`. `noah init` copies the three workflow skills to `.claude/skills/` and the runtime files to `.noah-kit/runtime/` when their corresponding manifest capabilities are enabled.

The Stop hook runs `scripts/stop-gate.js`. If Git reports a dirty working tree, it asks the main agent to inspect the diff and report verification evidence. It does not run project commands, infer the correct test command, or prove correctness. It fails open if hook input is malformed, Git is unavailable, or the hook has already blocked one stop attempt. These limits are deliberate to avoid trapping the user in a hook loop. The hook is a reminder; tests, review, and observed command output remain the source of verification evidence. The plugin also includes `scripts/verify-run.js`, which executes only a named command explicitly configured as an argument array in `.noah-kit/manifest.json`, stores full output and a verification record under `.noah-kit/verification/`, and fingerprints the Git revision plus changed-file contents. The Stop hook accepts a passing record only while its fingerprint, command configuration, and log remain current. The runner does not infer commands from package scripts; review configured commands before running them. Verification output is local and may need to be ignored by project version control.

The user-local Core installer includes the skill and runtime assets so `noah init` can generate a self-contained project adapter. The adapter stores hook registration in `.claude/settings.local.json`; it preserves existing settings and existing skill/runtime files, and it never runs project verification commands automatically.

## Initialization and onboarding

- `noah init` initializes a project, creates the committed project manifest and rule, installs workflow skills/runtime files, and registers the Stop hook in local Claude settings.
- The first initializer reviews the generated files and commits them to version control.
- On a later clone, the adapter identifies a project that declares Noah Kit but has no local installation.
- The user is offered installation. Declining is recorded only in local state and must not modify the shared project configuration.
- A later startup may ask again according to a configurable reminder policy. Users can always run the install or update command manually.
- Initialization must be safe to repeat and must preserve user-edited files. Conflicting generated files are reported for review rather than silently overwritten.

## Update checks

Scheduled checks are evaluated when the user starts a compatible Noah Kit/Claude Code session. Noah Kit cannot promise a check at a specific wall-clock time when the application is closed. An optional operating-system scheduler may be added later, but it must be separately configured and clearly disclosed.

A schedule such as 17:00 means: if a check is due and no successful check has happened for the configured interval, prompt on the next eligible startup. The timezone is `local` by default, and `UTC` can be set explicitly. Named IANA zones are not supported yet. Avoid repeated prompts within the same session.

`noah update-check` implements this evaluation on demand. It reads a validated release index whose entries pin exact Git commits, selects the newest compatible release, and records the result locally. It never installs anything. See `docs/releases.md` for the index schema, the trust model, and what it does not verify. No startup hook or OS scheduler invokes it yet.

Updates are opt-in by default. Security advisories, routine patches, feature releases, and breaking changes should be categorized separately. A project may pin a compatible version range; local installation policy must not silently bypass that constraint.

## Safe update transaction

1. Read the project manifest and local installation state.
2. Check the working tree and identify files Noah Kit would change.
3. Resolve the requested version and verify source integrity and compatibility.
4. Stage the new Core version separately from the active version.
5. Create a recoverable backup of managed files and relevant local metadata.
6. Validate and apply declared migrations only after explicit user approval when they execute code or modify project data.
7. Run compatibility and post-update checks.
8. Activate the new version only after required checks pass.
9. On failure, preserve diagnostics and restore the previous active version where safe; never claim rollback restored external data unless that was verified.

Migrations must declare an identifier, version range, affected paths, preconditions, and verification. Prefer idempotent migrations. Because arbitrary external side effects may not be reversible, rollback guarantees must be stated per migration.

## Safety invariants

- Mandatory security and verification rules cannot be disabled by project configuration.
- Project configuration can specialize behavior but cannot grant Core unrestricted write or execution authority.
- No script is executed solely because it exists in a repository or is referenced by a manifest.
- Dirty or conflicting user changes are preserved.
- Verification records include the command/check, timestamp, scope, exit status, and relevant result summary.
- A successful implementation step is not equivalent to verified acceptance.
- User-local state is never written into version-controlled project configuration.
- Core development mode is distinct from using Core to work on an ordinary project, preventing recursive self-installation behavior.

## Agent model

The main agent is the sole user-facing coordinator. It classifies each request into a tier, runs only the stages that tier requires, delegates those stages to specialized subagents, integrates their results, and owns commits and the final report. See `docs/agent-workflow.md` for the design and `.claude/rules/main-agent.md` for the requirements.

## Verification states

- `DIRTY`: relevant inputs or files changed since the last verification.
- `RUNNING`: a verification operation is in progress.
- `VERIFIED`: required checks ran successfully against the recorded scope and snapshot.
- `UNVERIFIED`: checks are missing, failed, stale, or cannot be tied to the current scope.

Only `VERIFIED` may be reported as verified, and only for the exact recorded scope.
