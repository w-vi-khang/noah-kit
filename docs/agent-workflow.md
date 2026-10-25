# Agent Workflow

Reader: maintainers of Noah Kit and of projects that use it. This document explains the design of the main-agent workflow. The enforceable requirements are in `.claude/rules/main-agent.md` and the agent definitions in `.claude/agents/`; this document does not restate them.

## Goal

Spend process in proportion to risk. A small task must not pay for planning, review, and verification it does not need. A large or safety-critical task must not skip them.

## Roles

- **Main agent (MA)**: the session the user talks to. It classifies each request, decides which stages run, delegates to subagents, integrates their results, commits, and reports. It is the only role that talks to the user, commits, or decides scope.
- **Subagents**: one per stage, each with a narrow role and its own tool boundary.

| Stage | Agent | Can edit |
| --- | --- | --- |
| Plan | `planner` | No |
| Implement | `implementer` | Owned files only |
| Test | `test-engineer` | Test files only |
| Review | `reviewer` | No |
| Verify | `verifier` | No |

Rationale for a separate test author: it is less likely to write tests shaped to the implementation.

Subagent definitions do not fix a model or effort. The same role needs different capability on different tasks: a reviewer of a typo fix and a reviewer of an update transaction should not cost the same. The MA chooses both for each request from the guide in `.claude/rules/main-agent.md`. Per-request `model` is documented (https://code.claude.com/docs/en/sub-agents, model resolution order); per-request `effort` is a parameter of the Agent tool in the Claude Code version used to write this document, but the documentation pages read so far do not describe it. If the MA omits `model`, Claude Code uses the agent definition's model (none is set here), then `CLAUDE_CODE_SUBAGENT_MODEL` when set, then the main conversation's model. What effort applies when the MA omits it is not documented in the pages read.

## Default model for the main agent

This repository sets `"model": "claude-opus-5-5"` and `"effortLevel": "high"` in the committed `.claude/settings.json`. A user can change this for themselves without editing the shared file:

- for one project: the same keys in `.claude/settings.local.json`;
- for one session: `claude --model <model> --effort <level>`;
- during a session: `/model` and `/effort`.

Source: Claude Code settings documentation (`model` and `effortLevel` keys, per-session flags, and precedence), https://code.claude.com/docs/en/settings.

## How tiers map to the original workflow

The original vision defines ten steps: understand, clarify, plan, select skills and agents, implement, test, review, address findings, verify, report. Tiers decide which of these run as separate stages:

- **All tiers** run understand, clarify (only when ambiguity changes the result), and report.
- **T0** stops after re-reading the diff.
- **T1** adds tests run by the MA. The original vision lists test output as independent evidence, so executed tests verify a T1 change without a separate reviewer. The MA's own description of the result does not count.
- **T2** adds a separate test author and an independent reviewer.
- **T3** adds a dedicated planner, user approval of the plan, and a verifier that checks the final committed state.

Tier criteria use concrete inputs (file counts, interface changes, named safety-critical areas) to reduce variation between runs. Whether runs actually agree has not been measured.

## Independence and loop prevention

The rule sets the requirements. The design choices behind them:

- **No self-approval** comes from separating roles and tool boundaries: read-only agents have no Edit or Write tools.
- **No nested delegation** comes from leaving the `Agent` tool out of every subagent. Claude Code withholds subagent spawning from an agent whose tool list lacks `Agent` (source: https://code.claude.com/docs/en/sub-agents).
- **Bounded retries** and a **single writer of history** keep a failing loop from running unattended.

## Limitations

These are instructions to the model, not enforced controls:

- Tier choice, stage selection, and briefs depend on the MA following `.claude/rules/main-agent.md`. Nothing blocks a skipped stage.
- Read-only agents have Bash, so they could still modify files. Their instructions forbid it, but nothing enforces it.
- Hooks could later enforce a verification gate or block subagent commits, once a hook safety contract exists.
- No skills exist yet. The MA rule allows using skills once they are defined.
- The structural test (`test/agents.test.js`) checks agent fields, that no agent fixes a model or effort, tool boundaries, and that the rule names every agent. It does not test how the model behaves in a real session.

## Distribution to other projects

Projects initialized with `noah init` do not receive the rule, agents, or settings yet. The proposed direction combines two mechanisms:

- **Core as a Claude Code plugin** carries the agents, later skills and hooks, and the `noah` CLI. Plugin agents get a scoped name such as `noah-kit:reviewer`. Claude Code uses the higher-priority definition when two agents share a name, and plugin agents have the lowest priority. The documentation does not say whether a project agent named `reviewer` shadows `noah-kit:reviewer`; this is unverified.
- **The Claude Code adapter generated by `init`** (defined in `docs/architecture.md`) carries what a plugin cannot provide: always-loaded instructions and default `model`/`effortLevel` settings. A plugin does not load `CLAUDE.md` or rules. Its `agent` setting replaces Claude Code's default system prompt entirely, so it is not used for the main agent.

Sources: https://code.claude.com/docs/en/plugins/components and https://code.claude.com/docs/en/sub-agents.

### Plugin prototype

This repository is also a plugin marketplace:

- `.claude-plugin/marketplace.json` lists one plugin, `noah-kit`, whose source is the repository root (`./`). The root is used because a plugin installed from a git-hosted marketplace is copied into the cache without files outside its directory, and `bin/noah` needs `src/`. A marketplace added from a local path loads the plugin in place instead, without copying or version pinning. `test/plugin.test.js` runs `bin/noah` from a copy of the committed files only.
- `.claude-plugin/plugin.json` sets the version, which `test/plugin.test.js` requires to equal `package.json`, and lists the agents in `.claude/agents/`, so the plugin has no second copy of them.
- `bin/noah` runs the command-line entry point `src/main.js`, which imports `run()` from `src/cli.js`. `src/cli.js` has no side effects on import, so the CLI does not depend on how its path was reached (symlinks, npm bin links, or the plugin cache). See `CONTRIBUTING.md` for running a checkout. Claude Code puts a plugin's `bin/` on the Bash tool's `PATH` after the user's own entries, so a `noah` already on the user's `PATH` (such as the launcher from `noah link`, if the user added it to `PATH`) takes precedence and may run a different Core version. `noah --version` shows which version runs. `bin/noah` is a POSIX shell script; there is no Windows `.cmd` equivalent, so Claude's PowerShell tool cannot run it.
- The plugin root contains `package.json` without a lockfile, so Claude Code installs no dependencies when it caches the plugin. Adding a lockfile would make Claude Code run a dependency install at cache time.

The shipped agents are written for this repository: their descriptions refer to the T0-T3 tiers in `.claude/rules/main-agent.md`, and `reviewer` checks Noah Kit's own safety rules. The plugin does not ship that rule, so in another project the agents lack that context until `init` generates it as part of the Claude Code adapter.

`claude plugin validate .` passes with one warning: `CLAUDE.md` at the plugin root is not loaded as plugin context. That file is this repository's own development instructions, so the warning is expected, and `--strict` fails because of it.

Not verified yet: loading the plugin in a live session, scoped agent names, per-request model and effort for plugin agents, and `bin/noah` on the Bash `PATH`. Open decisions: whether project settings enable the plugin (Claude Code then fetches it after workspace trust) or only declare the marketplace for the user to install, and whether the CLI's own `install`, `link`, and `update-check` remain once the plugin path is verified.
