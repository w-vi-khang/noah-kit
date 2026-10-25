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
- [ ] Evaluate the reminder interval and suppress prompts until it is due.
- [x] Test local decline persistence and ensure the committed manifest remains unchanged.
- [ ] Test the complete clone-to-onboarding flow inside Claude Code.

## Milestone 3: Versioned Core and safe updates

- [x] Add versioned Core installation into user-local storage.
- [ ] Add an explicit update command and release selection policy.
- [x] Constrain compatible Core versions in project configuration and fail closed on unsupported range syntax.
- [ ] Verify downloaded release metadata and integrity before activation.
- [x] Ensure the initial Core installer does not modify project files or overwrite an unmarked existing Core directory.
- [ ] Record update checks, successful updates, and failures in local state.
- [x] Stage initial installation in a temporary directory before activation.
- [ ] Add staged update activation, backup, recovery, and rollback tests.

## Milestone 4: Migration framework

- [ ] Define a migration manifest and compatibility contract.
- [ ] Preview affected paths and required actions before execution.
- [ ] Require explicit approval for code execution or project-data changes.
- [ ] Make migrations idempotent where practical and record each migration result.
- [ ] Test interruption, failure, rerun, and recovery behavior.

## Milestone 5: Claude Code workflow integration

- [ ] Add concise project entry instructions and built-in mandatory rules.
- [ ] Add risk-based task modes rather than always spawning multiple agents.
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
