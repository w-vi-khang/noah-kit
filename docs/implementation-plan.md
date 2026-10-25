# Implementation Plan

## Milestone 0: Repository contract

- [x] Establish English-only code and technical artifact policy.
- [x] Document Core, Project, and Local separation.
- [x] Define initial project manifest fields.
- [x] Record safety invariants and verification states.

## Milestone 1: Minimal working initialization

- [x] Choose and document a supported runtime and minimum version (Node.js 20+).
- [x] Implement a cross-platform `noah init` entry point.
- [x] Validate manifest structure and stable project identity.
- [x] Generate only minimal Claude Code adapter files.
- [x] Make initialization idempotent and preserve existing files without overwriting user changes.
- [x] Add automated tests for fresh initialization, repeated initialization, invalid manifests, and existing user files.
- [x] Add a CI workflow that runs tests on Windows, macOS, and Linux with Node.js 20 and 22.

Acceptance criteria:

- A fresh repository can be initialized with one documented command after the Core is installed.
- Re-running initialization does not duplicate or silently overwrite managed files.
- The generated project configuration is committed; user-local state is outside the repository.
- Invalid manifests fail with an actionable error and do not partially mutate the project.

## Milestone 2: Clone onboarding

- [x] Detect project configuration through `noah status` and validate it before installation.
- [ ] Offer an interactive install/skip choice on project startup.
- [x] Persist explicit declined-install choices only in local state, keyed by stable project identity.
- [x] Evaluate the reminder interval and suppress prompts until it is due in the `noah onboarding` decision command.
- [x] Test local decline persistence and ensure the committed manifest remains unchanged.
- [x] Test onboarding decision states, including missing manifest, compatible Core, recent decline, expired reminder, and incompatible Core range.
- [ ] Test the complete clone-to-onboarding flow inside a real Claude Code session.
- [ ] Add a deterministic Claude Code lifecycle hook for onboarding; the current Stop hook is only a verification reminder and does not implement onboarding.

## Milestone 3: Versioned Core and safe updates

- [x] Add versioned Core installation into user-local storage.
- [x] Define a release index schema with exact Git commit pins and fail-closed validation (`docs/releases.md`).
- [x] Add a report-only `noah update-check` command with a release selection policy (newest compatible version in the project's channel).
- [x] Evaluate the check schedule deterministically: one catch-up check after missed slots, 60-minute backoff after failures, and no background process.
- [x] Record update-check attempts, results, and failures in user-local state without a schema migration.
- [x] Test schedule evaluation, index validation, release selection, failure recording, and state preservation.
- [ ] Add an explicit update/install command that fetches a selected release and verifies its pinned commit before activation.
- [ ] Add signed release metadata with a pinned public key and replay protection; the current index is protected only by HTTPS and repository access control.
- [ ] Invoke the update check from a supported Claude Code startup hook or a user-configured OS scheduler.
- [x] Constrain compatible Core versions in project configuration and fail closed on unsupported range syntax.
- [ ] Verify downloaded release artifacts against their pinned commit before activation.
- [x] Ensure the initial Core installer does not modify project files or overwrite an unmarked existing Core directory.
- [ ] Record successful updates and update failures in local state.
- [x] Stage initial installation in a temporary directory before activation.
- [x] Generate a stable user-local launcher with Unix and Windows entry-point files.
- [x] Test launcher dispatch and refusal to overwrite unmanaged files.
- [ ] Add staged update activation, backup, recovery, and rollback tests.

## Milestone 4: Migration framework

- [ ] Define a migration manifest and compatibility contract.
- [ ] Preview affected paths and required actions before execution.
- [ ] Require explicit approval for code execution or project-data changes.
- [ ] Make migrations idempotent where practical and record each migration result.
- [ ] Test interruption, failure, rerun, and recovery behavior.

## Milestone 5: Claude Code workflow integration

- [x] Add concise project entry instructions and built-in mandatory rules.
- [x] Store a per-user conversation language in local state (`noah language <tag>`) and reference it from the generated rule; code stays in English.
- [x] Add mistake correction to the generated rule: root cause, fixing every instance, a prevention measure not kept only in local memory and placed in the kit or the project (or reported to the user when it concerns Noah Kit from another project), hooks only proposed, and reviewing existing files after a new requirement. This is an instruction; `test/cli.test.js` tests the generated text, not model behavior. Projects initialized earlier keep their old rule file until the refresh item below is implemented.
- [x] Require user approval in the generated rule before changing instruction files, hooks, or permission settings, and recommend the scripts, commands, or tests that the project's instructions name for deterministic steps (proposing a script when none exists). This is an instruction; `test/cli.test.js` tests the generated text, not model behavior.
- [x] Add `noah permissions`, which previews read-only project permission rules for the Core installation check and creates `.claude/settings.json` only with `--apply` and only when no settings file exists. `test/cli.test.js` and `test/claude-permissions.test.js` test the CLI, not whether Claude Code honors the rules.
- [x] Add plugin skills for workflow orchestration, failure diagnosis, and efficient verification, plus a Stop hook that prompts for evidence-based reporting on a dirty working tree. `test/hooks.test.js` covers registration and fail-open/anti-loop behavior; live Claude Code loading remains unverified.
- [ ] Verify in a live session that the trust dialog lists the rules and that they remove the Read prompts for the Core check, including on Windows (`~` resolution, PowerShell).
- [ ] Determine whether a supported mechanism lets Claude start a top-level child session (`claude --bg` via Bash, cloud Projects, the desktop app's session tools), and define its consent model.
- [ ] Evaluate the documented auto-compaction settings as the alternative to automatic context clearing, because no documented tool lets Claude run `/clear`.
- [ ] Add `Bash(noah …)` rules once the generated rule calls `noah` commands.
- [ ] Add a consented merge into an existing `.claude/settings.json`. Implement it before the adapter item below for default `model`/`effortLevel`.
- [ ] Offer a safe way to refresh an existing project's generated rule file when the template changes.
- [ ] Define a skill format, discovery, and installation for Core and projects.
- [ ] Enforce workflow gates with hooks (for example, blocking subagent commits or requiring verification before the final report) after a hook safety contract exists.
- [x] Add a main-agent rule with tiered task modes (T0-T3), and five specialized subagents (`planner`, `implementer`, `test-engineer`, `reviewer`, `verifier`) for this repository. These are instructions only; `test/agents.test.js` tests their structure (required fields, no fixed model or effort, no nested delegation, read-only boundaries, stage coverage), not model behavior. The main agent chooses each subagent's model and effort per request.
- [x] Default the main agent to Opus 5.5 at high effort in this repository's `.claude/settings.json`.
- [ ] Measure tier selection and stage adherence in real Claude Code sessions.
- [x] Package Core as a Claude Code plugin prototype: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, the five subagents, and `bin/noah`. `claude plugin validate .` passes with the expected root `CLAUDE.md` warning; `test/plugin.test.js` tests version parity, agent coverage, and `bin/noah`.
- [ ] Verify in a live Claude Code session: scoped plugin agent names, per-request model and effort for subagents, and `bin/noah` on the Bash `PATH`.
- [ ] Extend the Claude Code adapter generated by `init`: the main-agent rule referencing `noah-kit:*` agents, and default `model`/`effortLevel` without overwriting an existing `.claude/settings.json`.
- [ ] Decide the consent model for project-enabled plugins and whether the CLI `install`, `link`, and `update-check` remain.
- [ ] Give subagents explicit task IDs, file ownership, acceptance criteria, and handoff contracts.
- [ ] Add verification evidence and a final review gate.
- [ ] Test actual Claude Code hook/stop-gate integration before relying on it for enforcement.

## Milestone 6: Self-hosting and measured improvement

- [ ] Add a dedicated `kit-development` project mode.
- [ ] Keep foundational safeguards outside project-overridable rules.
- [ ] Add adversarial tests for weakening rules, false verification claims, recursive setup, and unsafe migrations.
- [ ] Measure task success, regressions, manual interventions, latency, token cost, and recovery rate before expanding agent complexity.

## Release policy

Do not mark a milestone complete because documentation exists. Completion requires implementation, tests against the acceptance criteria, a reviewed diff, and a record of which checks actually ran. Keep features disabled until their safety and compatibility contracts are implemented.
