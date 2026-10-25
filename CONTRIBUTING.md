# Contributing to Noah Kit

## Language policy

All code and technical artifacts committed to this repository must be written in English. This includes source code, identifiers, code comments, configuration keys and values where human-readable, test names, test fixtures, commit messages, technical documentation, agent instructions, and skill files. Preserve external protocol values and user-provided content when translation would change behavior. Conversation with project stakeholders may use their preferred language.

## Engineering rules

- Read the relevant architecture and existing implementation before making changes.
- Prefer the smallest end-to-end implementation that can be verified.
- Do not claim a check passed unless it was executed and its result was observed.
- Add or update tests for behavior changes; do not weaken a test merely to make an implementation pass.
- Keep Core, committed project configuration, and user-local state separate.
- Never run project-provided scripts or migrations solely because a manifest references them; require an explicit, reviewable operation and validate their scope first.
- Do not overwrite user modifications during installation or updates.
- Keep security boundaries and mandatory safeguards outside project-overridable configuration.
- Document platform assumptions and failure/recovery behavior.

## Change workflow

1. Inspect repository state and applicable instructions.
2. Define acceptance criteria before implementation.
3. Implement the smallest coherent change.
4. Run relevant tests and record actual results.
5. Review the diff for unintended changes, unsafe behavior, and documentation gaps.
6. Report completed work, checks run, checks not run, and known limitations.
