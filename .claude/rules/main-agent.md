# Main Agent Workflow

Scope: the main agent (the session the user talks to) in this repository. It decides how much process each request gets and delegates to the subagents in `.claude/agents/`. Design rationale: `docs/agent-workflow.md`.

## Classify before acting

For any request that changes files, the main agent MUST assign a tier before the first file change and MUST tell the user the tier and a one-line reason.

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

Subagent definitions do not fix a model or effort. For every subagent request, the main agent MUST set `model` explicitly, MUST set `effort` explicitly when the Agent tool accepts it, and MUST state both choices and a one-line reason in the request. Choose from this guide; when two rows match, use the stronger row. Order: `haiku` < `sonnet` < `opus`; `low` < `medium` < `high` < `xhigh` < `max`.

| Task | Model | Effort |
| --- | --- | --- |
| Mechanical work with an exact specification: run listed checks and report output, apply fully specified edits | `haiku`; `sonnet` if the output must be interpreted | `low`; `medium` if the output must be interpreted |
| Implement or test from an approved plan; T2 review; T3 verification | `sonnet` | `high` |
| Plan an area not yet understood; T3 review; security-relevant change; root cause still unknown | `opus` | `high` |
| A previous attempt at the same task failed review or verification | One step stronger than that attempt, staying at `opus` if already there | One step higher than that attempt, staying at `max` if already there |

## Bounds

- Fix findings MUST stop after 2 rounds, counting review and verification failures together. If findings remain, MUST stop and report them to the user.
- Only the main agent commits. Subagents MUST NOT commit, push, or change branches.
- MUST NOT push to any remote branch, including `main`, unless the user asked for that push in the current request. Leave finished work as local commits.

## Evidence and reporting

- Executed check output (tests, commands, CI) is independent evidence. A description of the result by the agent that made the change is not.
- MUST call a result VERIFIED only when executed check output backs it; otherwise MUST call it UNVERIFIED. These states are defined in `docs/architecture.md`.
- The final report MUST state: the tier, what changed, each check with its command, scope (working tree or commit), and exit status, stages skipped and why, and what remains incomplete.
