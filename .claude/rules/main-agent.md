# Main Agent Workflow

Scope: the main agent (the session the user talks to) in this repository. It decides how much process each request gets and delegates to the subagents in `.claude/agents/`. Design rationale: `docs/agent-workflow.md`.

## Classify before acting

For any request that changes files, the main agent MUST assign a tier before the first file change and tell the user the tier and a one-line reason. Use the highest tier whose criterion matches. If no criterion matches, use T1.

| Tier | Criterion (any one matches) |
| --- | --- |
| T3 Critical | Touches installation, update, migration, rollback, local-state schema or persistence, release integrity or trust, credentials or permissions, hooks, executing external code, or deleting or overwriting user data. Also any change the project's instructions mark safety-critical, and any breaking change to a public command or file format. |
| T2 Standard | Adds or changes a command, public interface, or file format; changes behavior in more than 3 files or more than one module; or changes instruction files, agent definitions, or Claude Code settings (`CLAUDE.md`, `.claude/`). |
| T1 Small | Changes behavior in at most 3 files of one module; or changes only tests or documentation. |
| T0 Trivial | Edits at most 2 files without changing behavior or meaning (typos, formatting, code comments). |

- MUST raise the tier as soon as new information matches a higher criterion. MUST NOT lower a tier after a T3 criterion matched.
- If a requirement is ambiguous in a way that changes the result, MUST ask the user before planning.
- If the user explicitly asks for less process than the tier requires, MAY comply, and MUST list the skipped stages in the final report.

## Stages per tier

| Stage | T0 | T1 | T2 | T3 |
| --- | --- | --- | --- | --- |
| Plan | — | Main agent | Main agent, or `planner` when the affected area is not yet understood | `planner`, then user approval of plan and acceptance criteria |
| Implement | Main agent | Main agent | Main agent or `implementer` | `implementer` |
| Tests | — | Main agent adds and runs tests, or states why no test applies | `test-engineer` for new behavior and failure paths | `test-engineer`, failure paths required |
| Review | — | — | `reviewer` | `reviewer` |
| Verify | Re-read the diff | Run the test suite | Run the test suite; main agent checks every acceptance criterion against evidence | `verifier` on the final committed state |

## Delegation

- Every subagent request MUST include: the goal, the files it owns, the acceptance criteria, the expected output, and what is already ruled out.
- `reviewer` and `verifier` MUST receive the diff or commit range and the acceptance criteria, not the implementer's conclusions.
- MAY run subagents in parallel only when their owned files do not overlap.
- MAY override a subagent's model or effort for one request when the task needs more or less capability than its default.
- MAY invoke an available skill when its activation conditions match the current stage.
- No hooks are defined. `CLAUDE.md` restricts adding them.

## Bounds

- Review-and-fix MUST stop after 2 rounds. If findings remain, stop and report them to the user.
- Only the main agent commits. Subagents MUST NOT commit, push, or change branches.
- MUST NOT push unless the user asked for it in the current request.

## Reporting

- MUST NOT report work as verified based only on the agent that implemented it.
- The final report MUST state: the tier, what changed, each check run with its result, stages skipped and why, and what remains incomplete.
- MUST call a result VERIFIED only when an executed check backs it; otherwise call it UNVERIFIED. These states are defined in `docs/architecture.md`.
