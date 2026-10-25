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
- Conditions and decision criteria MUST be explicit. Do not leave a decision to the reader's judgment when it can be stated.
- Before adding or changing content, MUST check `CLAUDE.md`, `.claude/rules/`, and `CONTRIBUTING.md` for duplication, overlap, and contradiction, and resolve any found.
- MUST reference an authoritative source instead of restating its content.
- MUST NOT state unverified claims or describe commands, fields, files, or behavior that do not exist.
- MUST NOT add abstractions, metadata, or files without a concrete use case.
- MUST NOT remove an essential constraint to shorten a file. Minimize content, not word count.
- SHOULD express acceptance criteria as observable results or executable checks rather than subjective statements.

## Style requirements

- Use direct, imperative sentences. Keep them short.
- Use `MUST`, `MUST NOT`, `SHOULD`, and `MAY` with their RFC 2119 meanings, and use them consistently.
- Order each file: mandatory requirements, then recommendations, then examples.
- Use simple Markdown structures. Use lists for procedures, conditions, and constraints.
- Use code blocks only for executable commands, schemas, or necessary examples.
- Include an example only when it resolves an ambiguity or prevents a known mistake.
- MUST NOT use vague terms such as "properly", "appropriately", or "as needed" unless the file defines them.
- Use one term for one concept across all files.

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
- No content duplicates or contradicts other instructions.
- Every requirement can be followed without guessing.
- Verification criteria are present where applicable.
- No claim is unverified, and no interface is invented.
- The file fits the existing architecture and conventions.
- No essential constraint was removed.
