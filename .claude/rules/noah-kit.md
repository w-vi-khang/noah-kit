# Noah Kit Project Instructions

This project declares Noah Kit in `.noah-kit/manifest.json`. Read that manifest before applying Noah Kit workflows.

## Mandatory rules

- Write all code, identifiers, code comments, tests, configuration keys, and technical documentation in English.
- Talk to the user in the language set in `preferences.communication_language` of the user-local state file described below (for example, `vi` is Vietnamese). This covers conversation, explanations, questions, and status reports only; code and technical artifacts stay in English. If it is not set, reply in the language the user writes in. The user can change it with `npx --yes github:w-vi-khang/noah-kit language <tag>`.
- Treat `.noah-kit/manifest.json` as committed project configuration, not as a place for user-local state or secrets.
- Do not claim a test or verification passed unless it was actually run and its result was observed.
- Preserve user changes. Do not overwrite conflicting files or run project scripts and migrations merely because they are referenced by configuration.
- Before prompting, read this project's manifest and inspect the user-local state file at `~/.noah-kit/state.json` (or the directory configured by `NOAH_HOME`). Match the entry by `project.id`.
- If `declined_install_at` exists and fewer than `updates.remind_after_days` days have elapsed, do not prompt again in this session. If the interval has elapsed, ask again.
- Treat Core as installed only when local state and its `core-manifest.json` marker agree. Check the project's Core version range; do not assume an incompatible version is usable.
- If no compatible Core is installed and no recent decline suppresses the prompt, ask the user whether they want to install it. Only after approval, suggest running `npx --yes github:w-vi-khang/noah-kit install`. Do not silently download or execute code.
- If the user declines, offer to record that choice locally with `npx --yes github:w-vi-khang/noah-kit decline`. Never write a declined-install choice into the committed manifest.
- Do not imply reminders or scheduled checks run while Claude Code is closed. Startup reminders are evaluated only when this rule is followed in a later session.

## Project setup

The manifest is the source of project-specific Noah Kit settings. Keep reusable kit implementation outside this repository. Store installation choices, caches, logs, and update timestamps in user-local state outside version control.
