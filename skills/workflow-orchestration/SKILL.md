---
name: workflow-orchestration
description: Apply Noah Kit's risk-tiered workflow, delegate bounded stages, and keep progress and handoffs concise. Use for any multi-step coding task.
---

# Workflow Orchestration

## Before editing
1. Read the relevant project instructions and configuration; inspect the existing implementation before proposing new files or abstractions.
2. If ambiguity could change the result, ask focused questions before editing.
3. State scope, governing documents, impact, tier, owners, and acceptance criteria. Keep T0/T1 planning brief.
4. Reuse existing scripts, hooks, skills, and project conventions. Do not create parallel infrastructure without a demonstrated gap.

## Choose the smallest adequate workflow
- **T0:** tiny non-behavioral change; inspect the diff.
- **T1:** small single-module change; run the relevant check.
- **T2:** public interface, multi-file, or multi-module change; separate test author and independent review.
- **T3:** safety-critical, installation/update, permissions, hooks, persistence, or destructive behavior; planner, approved plan, implementation, tests, independent review, and final verification.

Raise the tier when newly discovered impact requires it. Do not lower a tier after a safety-critical criterion has matched.

## Delegation
Every task brief must include goal, owned files, acceptance criteria, verification method, expected output, ruled-out approaches, and model/effort rationale. Reviewers and verifiers receive the diff and acceptance criteria, not the implementer's conclusions. Parallelize only non-overlapping file ownership. Subagents must not commit or push.

## Context and handoffs
- Keep durable decisions, constraints, acceptance criteria, completed work, checks, unresolved issues, and next actions in the task summary.
- Before context compaction or handing off, write a concise state note; never rely on conversational memory alone for critical decisions.
- Delegate broad searches and noisy command output; request only relevant excerpts and conclusions with evidence.
- Read focused file ranges and run focused tests before broad suites when that gives useful diagnostic signal.
- Do not repeat discovery or checks without a reason. Record what was already inspected and ruled out.

## Completion
Report changed files, commands and exit statuses, verification scope, skipped stages and reasons, and remaining risks. Use VERIFIED only when executed evidence supports it; otherwise use UNVERIFIED or PENDING. Never imply that a hook or instruction proves the code correct.
