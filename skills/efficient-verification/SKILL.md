---
name: efficient-verification
description: Run code checks efficiently, retain useful logs, and report verification without wasting context on repetitive or noisy output.
---

# Efficient Verification

1. Discover the project's documented verification commands before running anything. Never guess that a command is safe or appropriate solely because it exists in a manifest.
2. Run the narrowest relevant test or check first. Expand to the full suite when the change crosses modules, affects shared behavior, or the project requires it.
3. Prefer concise output modes. Preserve full output in a log when available; surface the command, exit code, failure count, and the relevant error/stack excerpt.
4. For many failures, group by likely root cause. Inspect one or two representative traces first, then check whether the rest share the same cause.
5. Do not rerun an unchanged failing command just to see if it passes. Rerun after a meaningful change, when checking a suspected flaky/environmental failure, or when new evidence justifies it.
6. Treat a command as verified only when it actually ran and its exit status/output was observed. A prior successful run does not verify files changed afterward.
7. If no appropriate check exists, report that limitation and ask whether a reusable check is warranted; do not create project infrastructure for a one-off task.
8. Separate confirmed facts, hypotheses, and unverified assumptions in the final report.
