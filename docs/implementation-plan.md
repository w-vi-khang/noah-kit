# Implementation Plan

## Milestone 0: Repository contract

- [x] Establish English-only code and technical artifact policy.
- [x] Document Core, Project, and Local separation.
- [x] Define initial project manifest fields.
- [x] Record safety invariants and verification states.

## Milestone 1: Minimal working initialization

- [ ] Choose and document a supported runtime and minimum version.
- [ ] Implement a cross-platform `noah init` entry point.
- [ ] Validate manifest structure and stable project identity.
- [ ] Generate only minimal Claude Code adapter files.
- [ ] Make initialization idempotent and detect conflicts without overwriting user changes.
- [ ] Add automated tests for fresh initialization, repeated initialization, and conflicting files.
- [ ] Add a CI workflow that runs the test suite on supported operating systems.

Acceptance criteria:

- A fresh repository can be initialized with one documented command after the Core is installed.
- Re-running initialization does not duplicate or silently overwrite managed files.
- The generated project configuration is committed; user-local state is outside the repository.
- Invalid manifests fail with an actionable error and do not partially mutate the project.

## Milestone 2: Clone onboarding

- [ ] Detect a project declaring Noah Kit when local Core is absent.
- [ ] Offer install/skip choices through a clear CLI flow.
- [ ] Persist skip decisions only in local state, keyed by stable project identity.
- [ ] Define when a declined installation may be prompted again.
- [ ] Test cloned project onboarding and local-state isolation.

## Milestone 3: Versioned Core and safe updates

- [ ] Add versioned Core installation and explicit update commands.
- [ ] Pin or constrain compatible Core versions in project configuration.
- [ ] Verify downloaded release metadata and integrity before activation.
- [ ] Protect dirty project files and preserve local customizations.
- [ ] Record update checks, successful updates, and failures in local state.
- [ ] Add staged activation, backup, recovery, and rollback tests.

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
