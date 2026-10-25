# Main Agent Workflow

Scope: the main agent (the session the user talks to) in this repository. It decides how much process each request gets and delegates to the subagents in `.claude/agents/`. Design rationale: `docs/agent-workflow.md`.

## Analyze before acting

For any request that changes files, before the first file change, the main agent MUST determine and tell the user:

1. **Scope**: the files and modules the change affects.
2. **Governing documents**: the sections of `docs/` and `.claude/rules/` that define the affected area. The main agent MUST read them in the current session and MUST say whether the change conforms. If it departs from them, MUST say how and ask the user before proceeding.
3. **Impact**: the behavior, interfaces, files, and users the change affects, and what could break.
4. **Tier**: assigned as described below, with a one-line reason.
5. **Tasks**: each task needed, with its stage, its owner (the main agent or a named subagent), and, for a subagent, its model and effort chosen as described in "Model and effort".

Once the tier is T0 or T1, each item MAY be one line.

## Classify

1. If the change touches at most 2 files and changes neither behavior nor meaning (typos, formatting, code comments), the tier is T0, whatever the paths.
2. Otherwise, the tier is the highest one whose criterion matches. If none matches, the tier is T1.

File counts exclude test files. Files in different top-level directories (for example `src/` and `docs/`) belong to different modules.

| Tier | Criterion (any one matches) |
| --- | --- |
| T3 Critical | Touches installation, update, migration, rollback, local-state schema or persistence, release index validation or release sources, credentials, permission settings, hooks, executing external code, or deleting or overwriting user data. Also any path listed as safety-critical in the project's `CLAUDE.md`, and any breaking change to a public command or file format. |
| T2 Standard | Adds or changes a command, public interface, or file format; changes behavior in more than 3 files or more than one module; or changes instruction files, agent definitions, or Claude Code settings (`CLAUDE.md`, `.claude/`). |
| T1 Small | Changes behavior in at most 3 files of one module; or changes only tests or documentation. |

- MUST raise the tier as soon as new information matches a higher criterion. MUST NOT lower a tier after a T3 criterion matched.
- If a requirement is ambiguous in a way that changes the result, MUST ask the user before planning.
- If the user explicitly asks for less process than the tier requires, MAY comply, and MUST list the skipped stages in the final report.

## Stages per tier

| Stage | T0 | T1 | T2 | T3 |
| --- | --- | --- | --- | --- |
| Plan | — | Main agent | `planner` if the change spans more than 5 files the main agent has not read in this session; otherwise main agent | `planner`, then user approval of plan and acceptance criteria |
| Implement | Main agent | Main agent | `implementer` if more than 3 non-test files change; otherwise main agent | `implementer` |
| Tests | — | Main agent adds and runs tests. For test- or docs-only changes: run the affected tests, if any | `test-engineer` for new behavior and failure paths | `test-engineer`, failure paths required |
| Review | — | — | `reviewer` | `reviewer` |
| Fix findings | — | — | The stage's author fixes; rerun tests; `reviewer` re-reviews the fix | The stage's author fixes; rerun tests; `reviewer` re-reviews the fix |
| Verify | Re-read the diff | Run the test suite | Run the test suite; main agent checks every acceptance criterion against executed checks | `verifier` on the final working tree, before the commit |

## Delegation

- Every subagent request MUST include: the goal, the files it owns, the acceptance criteria, how the result will be verified, the expected output, and what is already ruled out.
- `reviewer` and `verifier` MUST receive the diff and the acceptance criteria, not the implementer's conclusions.
- MAY run subagents in parallel only when their owned files do not overlap.
- MAY invoke an available skill when its activation conditions match the current stage.
- MUST NOT add or rely on hooks; none are defined, and `CLAUDE.md` restricts adding them.

## Model and effort

Subagent definitions do not fix a model or effort. For every subagent request, the main agent MUST decide both and MUST state them, with a one-line reason, in the task list and in the request. It MUST pass `model` to the Agent tool, and MUST pass `effort` when the Agent tool accepts it. Use the first row that matches the request's tier and stage.

| Request | Model | Effort |
| --- | --- | --- |
| T0-T2, and the request only runs listed checks and reports their output, or applies fully specified edits | `haiku` | `low` |
| T3 plan or review | `opus` | `high` |
| T3 implement, test, or verify | `sonnet` | `high` |
| T2 plan or review | `sonnet` | `high` |
| T2 implement or test | `sonnet` | `medium` |
| Any other request | `sonnet` | `high` |

If a previous attempt at the same request failed review or verification, MUST raise the model one step and the effort one step from that attempt, and MUST stay at the highest value when already there. Order: `haiku` < `sonnet` < `opus`; `low` < `medium` < `high` < `xhigh` < `max`.

## Bounds

- Fix findings MUST stop after 2 rounds, counting review and verification failures together. If findings remain, MUST stop and report them to the user.
- Only the main agent commits. Subagents MUST NOT commit, push, or change branches.
- MUST NOT push to any remote branch, including `main`, unless the user asked for that push in the current request. Leave finished work as local commits.

## Evidence and reporting

- Executed check output (tests, commands, CI) is independent evidence. A description of the result by the agent that made the change is not.
- MUST call a result VERIFIED only when executed check output backs it; otherwise MUST call it UNVERIFIED. These states are defined in `docs/architecture.md`.
- The final report MUST state: the tier, what changed, each check with its command, scope (working tree or commit), and exit status, stages skipped and why, and what remains incomplete.
