# Noah Kit Project Instructions

Scope: every Claude Code session in a project that contains `.noah-kit/manifest.json`. The manifest is the authoritative source of this project's Noah Kit settings. Read it before applying the rules below.

## Language

- Code, identifiers, code comments, tests, configuration keys, and technical documentation MUST be in English.
- Conversation with the user (explanations, questions, status reports) MUST use the language in `preferences.communication_language` of the local state file (for example, `vi` is Vietnamese). If it is not set, MUST reply in the language the user writes in. The user changes it with `npx --yes github:w-vi-khang/noah-kit language <tag>`.

## Configuration and changes

- `.noah-kit/manifest.json` is committed project configuration. MUST NOT write local state or secrets to it.
- MUST NOT copy the Noah Kit Core implementation into the project. Installation choices, caches, logs, and update timestamps belong in local state, outside version control.
- MUST preserve user changes. MUST NOT overwrite conflicting user files.
- MUST NOT run project scripts or migrations only because configuration references them.
- MUST NOT report a test or verification as passed unless it ran and its result was observed.

## Core installation check

Local state file: `~/.noah-kit/state.json`, or `state.json` in the directory set by `NOAH_HOME`. Project entries are keyed by the manifest's `project.id`.

At the start of a session, apply the first matching step:

1. Core is usable when local state lists an installation whose directory contains `src/cli.js` and a `core-manifest.json` with `package_name` `noah-kit` and the same version, and that version satisfies the manifest's `kit.core_version_range`. If Core is usable, take no action.
2. If the project entry has `declined_install_at` and the reminder interval has not elapsed, MUST NOT ask about installation. The interval in days is the first non-negative integer among the entry's `declined_remind_after_days` and the manifest's `updates.remind_after_days`, else 1.
3. Otherwise, MUST ask the user whether to install Core. Only after approval, suggest `npx --yes github:w-vi-khang/noah-kit install`. MUST NOT download or run code without approval.

If `install` reports that the Core version does not satisfy the project's required range, MUST tell the user that no compatible Core release is available and MUST NOT retry the installation.

If the user declines, offer to record the choice with `npx --yes github:w-vi-khang/noah-kit decline`. MUST NOT record the decline in the manifest.

This check runs only during a session that follows this rule. MUST NOT state that reminders or scheduled checks run while Claude Code is closed.
