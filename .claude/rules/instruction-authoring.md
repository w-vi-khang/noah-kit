---
paths:
  - "**/CLAUDE.md"
  - ".claude/**/*.md"
  - "**/SKILL.md"
  - "README.md"
  - "CONTRIBUTING.md"
  - "docs/**/*.md"
---

# Instruction Authoring Standard

Scope: creating or editing AI instruction files (`CLAUDE.md`, rules, skills, hooks, agent definitions), instruction text that Noah Kit generates (such as the rule template in `src/cli.js`), and technical documentation in this repository.

When requirements conflict, apply this priority: correctness, then clarity, then completeness, then conciseness.

## Content requirements

- Each file MUST state one purpose and scope. Split unrelated responsibilities into separate files or sections.
- Each instruction MUST express one requirement or action. It MUST say when it applies and what outcome is expected.
- Conditions and decision criteria MUST be explicit. MUST NOT leave a decision to the reader's judgment when it can be stated.
- MUST include only information needed for the file's purpose. Remove filler and repetition.
- Before adding or changing content, MUST check existing instructions (at least `CLAUDE.md`, `.claude/rules/`, and `CONTRIBUTING.md`) for duplication, overlap, and contradiction, and resolve any found.
- MUST reference an authoritative source instead of restating its content.
- MUST NOT state unverified claims or describe commands, fields, files, or behavior that do not exist.
- MUST NOT add abstractions, metadata, or files without a concrete use case.
- MUST NOT remove an essential constraint to shorten a file. Minimize content, not word count.
- SHOULD express acceptance criteria as observable results or executable checks rather than subjective statements.

## Style requirements

- Every requirement MUST use `MUST`, `MUST NOT`, `SHOULD`, or `MAY` with its RFC 2119 meaning.
- MUST use direct, imperative sentences. SHOULD keep each sentence to one requirement.
- MUST order each file: mandatory requirements, then recommendations, then examples.
- SHOULD use simple Markdown structures. MUST use lists for procedures, conditions, and constraints.
- MUST use code blocks only for executable commands, schemas, or necessary examples.
- MAY include an example only when it resolves an ambiguity or prevents a known mistake.
- MUST NOT use vague terms such as "properly", "appropriately", or "as needed" unless the file defines them.
- MUST use one term for one concept across all files.

## File-type requirements

| Type | MUST define |
| --- | --- |
| Skill | Purpose, activation conditions, prerequisites, procedure, constraints, and verification criteria. Load detailed references only when the procedure needs them. |
| Rule | Scope and enforceable requirements that apply throughout that scope. Task-specific procedures belong in skills. |
| Hook | Trigger, inputs, expected behavior, failure handling, and exit semantics. Keep each hook narrow and deterministic. Put complex logic in scripts, not in configuration. |
| Docs | Facts, architecture, interfaces, decisions, or procedures for an identified reader. Name authoritative sources. Distinguish confirmed facts from assumptions. |

## Verification

Before finishing, confirm each item. If one fails, revise the file.

- The file has one purpose and scope.
- The file contains no content beyond what its purpose needs.
- No content duplicates or contradicts other instructions.
- Every requirement uses an RFC 2119 keyword and can be followed without guessing.
- Verification criteria are present where applicable.
- No claim is unverified, and no interface is invented.
- The file fits the existing architecture and conventions.
- No essential constraint was removed.
