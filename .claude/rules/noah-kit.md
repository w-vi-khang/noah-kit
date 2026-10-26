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

## Changing instructions, hooks, and permissions

Instruction files are `CLAUDE.md`, files in `.claude/rules/`, agent definitions in `.claude/agents/`, and skills. Permission settings are the `permissions` entries in Claude Code settings files.

- Before adding, changing, or removing an instruction file, a Claude Code hook, a Git hook, or a permission setting, MUST describe the change to the user and MUST get the user's approval.
- If the user's request names that change, the request is the approval.
- If a subagent would make the change, the agent that delegates it MUST get the approval before delegating.
- Approval MUST NOT override a `MUST NOT` in the project's instructions. The user MAY lift that `MUST NOT` by approving a change to the instruction that contains it.
- Tests and scripts that belong to an approved change MAY be added without separate approval.

## Deterministic steps

A deterministic step gives the same result for the same input without judgment, such as counting changed files, comparing two files, or validating a file against a schema.

- For a deterministic step, SHOULD use the script, command, or test that `CLAUDE.md`, `.claude/rules/`, or `CONTRIBUTING.md` names for it.
- MUST NOT run a script for a deterministic step if only the manifest or a file other than `CLAUDE.md`, `.claude/rules/`, or `CONTRIBUTING.md` names it.
- If no such script exists for a deterministic step that an instruction in `CLAUDE.md`, `.claude/rules/`, or `CONTRIBUTING.md` requires, SHOULD propose a reusable script to the user.
- MAY propose a reusable script for another deterministic step that recurs across tasks, and MUST state why it recurs.
- SHOULD NOT add a script file to the project for a deterministic step that only the current task needs. A command run once in a shell is not a script file.

## Correcting mistakes

A mistake is a result of the agent's work, including work it delegated, that contradicts the user's request, an instruction, an acceptance criterion, or a verifiable fact, after the agent reported that result to the user as done or as fact. The steps below apply whether the agent, the user, or a reviewer finds the mistake. A failing check or a review finding on work not yet reported as done is not a mistake; the project's change process handles it.

When a mistake is detected:

1. MUST identify the root cause: the missing, unclear, or ignored instruction, or the missing check, that allowed the mistake.
2. MUST search the files changed in the current session, and other files that contain the same pattern (for example, with `git grep`), for other instances of the same mistake. MUST fix every instance found.
3. MUST add or strengthen a prevention measure: an instruction, a test, or another executable check that would have prevented or detected the mistake.
   - If an existing instruction already requires the correct behavior, MUST NOT add a duplicate. MUST make that instruction more explicit or add a check that detects the violation.
   - MUST NOT keep a prevention measure only in the agent's local memory.
   - MUST NOT add an ad hoc Claude Code hook or Git hook as a prevention measure without explicit user approval and a tested failure/loop contract. If only a hook can prevent the mistake, MUST propose it to the user first. Reusable Noah Kit plugin hooks are governed by the approved Core change and hook-specific tests.
   - A measure that changes an instruction file or a permission setting MUST follow "Changing instructions, hooks, and permissions". If the user has not approved it, MUST report it as proposed, not as applied.
4. MUST apply the prevention measure according to where the work happens:
   - In the Noah Kit source repository (its root `package.json` has `name` `noah-kit`), MUST apply it in that repository.
   - In another project, MUST apply the part of the measure that changes only the project's own files in that project.
   - In another project, MUST NOT edit Noah Kit files: this rule file and the Core installation directory. If the measure needs a change to them or to the manifest format, MUST warn the user and describe the mistake, its root cause, and the proposed change, so that the user can report it to the Noah Kit maintainers.
5. MUST report to the user: the mistake, its root cause, the instances fixed, and the prevention measure applied or proposed.

- MUST finish steps 1 to 5 before reporting the original task as done.
- Fixes and prevention measures MUST follow the project's change process and its limits, including the tiers and fix-round bounds in `.claude/rules/main-agent.md` where that file exists. A change process is a written procedure for making and verifying changes, such as stages, review, or verification steps, in `CLAUDE.md`, `CONTRIBUTING.md`, or a file in `.claude/rules/` other than this one. If the project has none, MUST ask the user before applying a prevention measure.
- MUST report to the user every instance and every prevention measure left unapplied because of those limits.
- A subagent MAY read any file for step 2. It MUST edit only the files its task allows. It MUST report the root cause, the instances it could not fix, and the proposed prevention measure to the agent that delegated the task. That agent MUST complete the remaining work in steps 2 to 5.

## Reviewing after a new requirement

- After adding a requirement (`MUST` or `MUST NOT`) or making one stricter, MUST review the existing files within the requirement's stated scope for compliance with it. If the requirement states no scope, MUST ask the user for the scope before reviewing.
- MUST fix non-compliant files that the user's request named or that the current change created or modified. A fix to an instruction file or a permission setting MUST follow "Changing instructions, hooks, and permissions".
- For any other non-compliant file, MUST list it and ask the user before changing it.

## Core installation check

Local state file: `~/.noah-kit/state.json`, or `state.json` in the directory set by `NOAH_HOME`. Project entries are keyed by the manifest's `project.id`.

At the start of a session, apply the first matching step:

1. Core is usable when local state lists an installation whose directory contains `src/cli.js` and a `core-manifest.json` with `package_name` `noah-kit` and the same version, and that version satisfies the manifest's `kit.core_version_range`. If Core is usable, take no action.
2. If the project entry has `declined_install_at` and the reminder interval has not elapsed, MUST NOT ask about installation. The interval in days is the first non-negative integer among the entry's `declined_remind_after_days` and the manifest's `updates.remind_after_days`, else 1.
3. Otherwise, MUST ask the user whether to install Core. Only after approval, suggest `npx --yes github:w-vi-khang/noah-kit install`. MUST NOT download or run code without approval.

If `install` reports that the Core version does not satisfy the project's required range, MUST tell the user that no compatible Core release is available and MUST NOT retry the installation.

If the user declines, offer to record the choice with `npx --yes github:w-vi-khang/noah-kit decline`. MUST NOT record the decline in the manifest.

This check runs only during a session that follows this rule. MUST NOT state that reminders or scheduled checks run while Claude Code is closed.
