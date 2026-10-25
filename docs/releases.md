# Release Index and Update Checks

This document defines the release metadata format and the update-check policy implemented by `noah update-check`. It also states what the current implementation does not do.

## Scope

`noah update-check` answers one question: is there a published Core release that is newer than the local baseline and compatible with this project? It reads a release index, records the result in user-local state, and prints a decision. It never downloads, stages, installs, or activates a release, regardless of `updates.auto_install`.

## Release index schema (version 1)

The official index is `releases.json` at the root of this repository and is fetched from:

```
https://raw.githubusercontent.com/w-vi-khang/noah-kit/main/releases.json
```

```json
{
  "schema_version": 1,
  "kit_id": "noah-kit",
  "releases": [
    {
      "version": "0.2.0",
      "channel": "stable",
      "published_at": "2026-11-01T00:00:00.000Z",
      "classification": "feature",
      "source": {
        "type": "git",
        "repository": "github:w-vi-khang/noah-kit",
        "commit": "<full 40-character lowercase Git commit ID>"
      }
    }
  ]
}
```

Validation rules. Any violation rejects the entire index; Noah Kit does not skip bad entries and use the rest.

- `schema_version` must be `1` and `kit_id` must be `noah-kit`.
- `version` must be a stable `MAJOR.MINOR.PATCH` version. Pre-release versions are not supported.
- `channel` must match `^[a-z][a-z0-9-]{0,31}$`. A channel/version pair may appear only once.
- `published_at` must be a parseable ISO 8601 timestamp.
- `classification` must be one of `security`, `patch`, `feature`, or `breaking`.
- `source.type` must be `git`; `source.repository` must be `github:<owner>/<name>`; `source.commit` must be a full 40-character lowercase commit ID. Other source types are rejected until they are designed and tested.
- The index may contain at most 1000 releases and 1 MiB of data.

The committed index currently lists no releases. Publishing a release means adding an entry that pins the exact commit for that version. That is a deliberate maintainer action; Noah Kit does not generate entries automatically.

## Release selection

The candidate is the highest version in the project's `updates.channel` (default `stable`) that is:

1. newer than the baseline, and
2. compatible with the project's `kit.core_version_range` when a project manifest exists.

The baseline is the newest valid local Core installation that satisfies the project range, as confirmed by its `core-manifest.json` marker and CLI entry point. If no such installation exists, the baseline is the running CLI version.

## Release sources and trust model

The source comes from `--source`, then the `NOAH_RELEASE_SOURCE` environment variable, then the official URL. A project manifest cannot redirect the release source, because committed configuration must not be able to point a developer's machine at an arbitrary index.

Only `https://` URLs and local file paths are accepted. HTTP redirects are refused, requests time out after 10 seconds, and responses larger than 1 MiB are rejected.

What the current design establishes:

- The index content was served over TLS by the configured host. For the official source, that means it matches the `main` branch of the GitHub repository as served by GitHub.
- Each release entry pins an exact Git commit. When release installation is implemented, the installer must verify that the content it activates is that commit, so a moving branch or tag cannot substitute different code for a published version.

What it does **not** establish:

- **No signatures.** Nothing proves who published the index. Anyone with write access to the repository, or the ability to compromise GitHub or the TLS path, can publish a malicious index. There is no trusted-key distribution.
- **Git commit IDs are SHA-1.** A commit ID binds content in a practical sense, but it is not a modern cryptographic integrity guarantee and is not a signature.
- **No rollback or freeze protection.** A stale or replayed index is accepted if it is otherwise valid.
- **Local file sources are trusted as given.** They are intended for tests and offline mirrors.

A path to stronger verification would use signed release metadata, such as Sigstore or minisign signatures over the index, with a public key pinned in Core, together with expiry timestamps to resist replay. That work is not started.

## Check schedule

The schedule comes from the project manifest:

| Field | Default | Supported values |
| --- | --- | --- |
| `updates.check_on_startup` | `true` | boolean. `false` makes `update-check` report `CHECK_DISABLED` unless `--force` is used. |
| `updates.check_after_local_time` | `17:00` | 24-hour `HH:MM` |
| `updates.timezone` | `local` | `local` or `UTC`. IANA zone names are rejected rather than approximated. |
| `updates.channel` | `stable` | channel name |

A check is due when no successful check has been recorded since the most recent scheduled slot, meaning the latest occurrence of `HH:MM` at or before now. Consequences:

- If several slots are missed, for example while Claude Code or the machine is off, the next evaluation runs **one** catch-up check, not one per missed day.
- After a successful check, the next check is due at the next slot.
- After a failed check (network error, HTTP error, malformed index), automatic evaluation waits at least 60 minutes before retrying. `--force` bypasses this.
- A recorded success timestamp more than five minutes in the future is treated as untrustworthy, and a check becomes due.

**Nothing runs in the background.** The schedule is evaluated only when `noah update-check` is invoked. No OS scheduler, daemon, or Claude Code lifecycle hook calls it yet. A "17:00" policy therefore means "the first invocation at or after 17:00", not "a check at 17:00".

Two invocations that start at exactly the same time may both perform a check. Each re-reads local state before writing its record, so other state is not lost, but there is no lock.

## Local state

Results are stored in `state.json` under the Noah Kit home, keyed by channel:

```json
{
  "update_checks": {
    "stable": {
      "source": "https://raw.githubusercontent.com/w-vi-khang/noah-kit/main/releases.json",
      "last_attempt_at": "2026-10-26T17:02:11.000Z",
      "last_success_at": "2026-10-26T17:02:11.000Z",
      "last_result": "UPDATE_AVAILABLE",
      "latest_known_version": "0.2.0"
    }
  }
}
```

`update_checks` is optional, so state files written by earlier versions remain valid without a schema migration. Earlier Core versions preserve the field when they rewrite state, because they write back the full loaded object. Malformed records make state loading fail rather than being reset.

## Command results

| Output prefix | Exit code | Meaning |
| --- | --- | --- |
| `CHECK_DISABLED` | 0 | The project disabled checks; nothing was fetched. |
| `CHECK_NOT_DUE` | 0 | Not due (`NOT_DUE`) or backing off after a failure (`BACKOFF`); nothing was fetched. |
| `UP_TO_DATE` | 0 | The index was read and no newer compatible release exists. |
| `UPDATE_AVAILABLE` | 0 | A newer compatible release exists. Nothing was downloaded or installed. |
| `CHECK_FAILED` | 1 | The index could not be read or validated. The failure was recorded. |

Configuration errors fail with exit code 1 before any state is written. These include an unsupported timezone or check time, a non-HTTPS source, and invalid local state.
