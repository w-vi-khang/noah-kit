---
name: failure-diagnosis
description: Diagnose failing tests, review findings, or verification errors by identifying root cause and preventing unproductive retry loops.
---

# Failure Diagnosis

## Required sequence
1. **Capture evidence:** exact failing test/check, command, exit code, assertion or error, expected versus actual behavior, and the relevant stack trace.
2. **Reproduce narrowly:** run the smallest check that reliably reproduces the failure. Preserve the original output.
3. **Trace the cause:** inspect the failing assertion and implementation path. Classify the failure as production defect, incorrect test/expectation, environment/dependency issue, or inconclusive. State evidence for the classification.
4. **Choose one minimal fix:** change the source of the failure, not merely the symptom. Do not weaken or delete a valid test to obtain a pass.
5. **Verify the fix:** rerun the focused check, then the relevant suite if warranted. Report both outcomes.
6. **Prevent recurrence:** when a reported mistake is confirmed, search for other instances of the same pattern and add a durable test, instruction, or executable check.

## Retry limits
- Count a fix round as one specific diagnosis/fix attempt followed by rerunning the failed check; merely rerunning a test without a code change is not a fix round.
- Maximum two fix rounds for the same finding. If the same evidence returns without meaningful progress, stop and explain why.
- Do not begin unrelated stages while a required check is failing. Fix the failure or mark the task PENDING.
- If the failure changes, diagnose the new failure independently; do not assume it has the same root cause.
- Do not add a new script, hook, agent, or abstraction just because one test failed. First determine whether existing infrastructure can solve it.
- If root cause remains uncertain, say so. Do not invent a cause or claim a fix without confirming evidence.

## Failure report
Include:
- failing check and evidence;
- root cause and confidence;
- files changed and why;
- exact verification command and result;
- remaining findings and status: VERIFIED, UNVERIFIED, or PENDING.
