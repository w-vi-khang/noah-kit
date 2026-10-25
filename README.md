# Noah Kit

Noah Kit is a project-aware workflow kit for Claude Code. It is designed to keep reusable kit logic separate from project-specific configuration and user-local state.

## Foundational principles

- **English-only code:** All source code, identifiers, code comments, configuration keys, test names, commit messages, and technical documentation maintained as part of the kit must be written in English. User-facing explanations may use the user's preferred language.
- **Separation of concerns:** Keep reusable Core logic, committed project configuration, and user-local state separate.
- **Explicit installation:** A project can describe the required kit, but installing or updating executable Core components must be an explicit, reviewable action.
- **Safe updates:** Never overwrite uncommitted project changes. Validate versions and compatibility before applying updates.
- **Evidence-based verification:** Report checks as passed only when the corresponding command or check actually ran and its result was observed.
- **Least surprise:** No background behavior should be implied when Claude Code is not running. Scheduled checks happen on a later startup unless an optional external scheduler is explicitly configured.
- **Human control:** Declining installation is remembered locally, and users can install or update manually at any time.

## Initial implementation scope

The first milestone establishes the architecture, manifest contract, initialization behavior, and safety boundaries before adding automated updates, migrations, or multi-agent orchestration.

## Status

This repository is being initialized. The architecture and implementation plan are intentionally staged so that the first working path can be tested end-to-end before more features are added.
