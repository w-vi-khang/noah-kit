# Noah Kit Development Instructions

Scope: developing Noah Kit itself in this repository. Rules that apply to every Noah Kit project, including this one, are in `.claude/rules/noah-kit.md`.

## Required reading

- Before an architectural change, MUST read `README.md`, `CONTRIBUTING.md`, `docs/architecture.md`, and `docs/implementation-plan.md`.
- Before creating or editing an instruction file, generated instruction text (including the rule template in `src/cli.js`), or documentation, MUST read `.claude/rules/instruction-authoring.md`.

## Language

- Committed content MUST be in English. This covers code, identifiers, comments, configuration keys and human-readable values, tests, fixtures, commit messages, documentation, skills, agent instructions, and generated project instructions.
- MUST preserve protocol-defined values and external user content when translating them would change behavior.
- Conversation language is set per user; see `.claude/rules/noah-kit.md`.

## Repository safety

- Core logic, committed project configuration, and local state MUST stay separate.
- `.noah-kit/manifest.json` MUST NOT contain credentials, machine-specific paths, declined-install state, caches, or update timestamps.
- MUST NOT add update automation, executable hooks, or migration execution until a safety contract and tests for it exist.
- MUST NOT overwrite user-authored files. Initialization MUST detect conflicts before writing and preserve existing content.

## Changes and verification

- SHOULD keep each change to one concern that can be tested end to end.
- MUST add tests for every behavior change.
- A successful command does not complete a task. MUST verify the acceptance criteria and scope.
- Before delegating to a subagent, MUST define its task ownership, expected output, acceptance criteria, and how the result will be verified.

## Implementation boundary

- `docs/implementation-plan.md` is the authoritative record of what is implemented. Checked items are implemented and tested; unchecked items are not.
- MUST NOT describe an unchecked item as implemented in code, documentation, or conversation.
- When a change implements or removes a planned item, MUST update its checkbox in the same change.
