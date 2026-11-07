# openclaw/openclaw#194813: isolated Gateway validation (macOS, stub providers)

Evidence for [openclaw/openclaw#194813](https://github.com/openclaw/openclaw/pull/194813)
("fix: compaction skips configured fallback after quota errors"), which closes
[openclaw/openclaw#194803](https://github.com/openclaw/openclaw/issues/194803).
Captured 2026-11-07. All runs used loopback stub providers; no real inference provider was called.

## Builds

| Label | Commit |
| --- | --- |
| PR head | `30ff6a55d5b755cf4f677b9a579e684c72f7282e` |
| `origin/main` (red base) | `1ad3ec3d2081f3c7228b5bed8ae95e3821cd609f` |

The PR diff applies cleanly to that `main`. The files on the fallback path outside the diff are
byte-identical between the two builds: `compact.ts`, `failover-error.ts`,
`assistant-message-failures.ts`, `packages/agent-core/src/harness/types.ts`,
`summarization-completion.ts`, `compaction-summary-refusal.ts`, `compaction-session-execution.ts`.

Host: macOS 26.5.2 arm64. Launcher, driver and tests: Node v24.22.1, pnpm 12.15.0.
Gateway process runtime (from its log metadata): Bun 1.4.4, as started by `scripts/run-node.mjs`.

## Scenario

- Two OpenAI-compatible chat-completions stubs on separate loopback ports and provider ids
  (`harness/stub-providers.mjs`): `stuba` (primary) and `stubb` (fallback), both `api: "openai-completions"`, `contextWindow: 64000`.
- `stuba` answers chat turns and returns HTTP 429 `{"error":{"message":"daily token quota exhausted"}}`
  for every summarization request (no error code, no "too many requests" wording).
- `stubb` returns a five-section structured summary carrying the marker `FALLBACK-SUMMARY-194803`.
- Config (`runs/*/openclaw.json`): `agents.defaults.model = {primary: "stuba/m", fallbacks: ["stubb/m"]}`,
  `agents.defaults.compaction = {mode: "safeguard"}`, `compaction.model` unset, `models.mode: "replace"`.
- Gateway per run: `node scripts/run-node.mjs gateway run --port <ephemeral> --bind loopback --auth none --tailscale off --allow-unconfigured`,
  throwaway `HOME`/`OPENCLAW_HOME`/`OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH`/`TMPDIR`/`XDG_*`, an allowlisted
  environment with no inherited `OPENCLAW_*` or provider keys, and `OPENCLAW_SKIP_CHANNELS/CRON/BROWSER_CONTROL_SERVER/CANVAS_HOST/GMAIL_WATCHER=1`,
  `OPENCLAW_DISABLE_BUNDLED_PLUGINS=1` (`runs/*/gateway-command.txt`).
- Driver (`harness/drive.mts`): `GatewayClient` from the same checkout, `chat.send` on one session with
  ~24k-character user turns until a turn's preflight runs budget-triggered compaction (turn 6 on both builds).
  The manual variant sends two turns, then `/compact`.
- Persisted result: `harness/inspect-state.mjs` reads the throwaway agent SQLite transcript read-only and decodes
  compaction entries (`runs/*/state-inspection.json`).

## Results

| Run | Build | Trigger | Primary summary 429s | Fallback summary requests | `model-fallback/decision` | Compaction persisted | User-visible outcome |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| `gateway-origin-main` | main | budget | 3 | 0 | none | none | turn error: "This conversation is too long, and OpenClaw couldn't shorten it…" |
| `gateway-pr-head` | PR | budget | 3 | 2 | `candidate_failed` stuba/m `rate_limit` 429 → stubb/m, then `candidate_succeeded` stubb/m | yes: `tokensBefore` 48109, fallback marker in summary, `model-snapshot provider=stubb` before the entry | turn replied normally |
| `gateway-origin-main-manual-compact` | main | `/compact` | 3 | 0 | none | none | "⚙️ Compaction failed: … 429 daily token quota exhausted \| summarization_failed" |
| `gateway-pr-head-manual-compact` | PR | `/compact` | 3 | 2 | same as above | yes, fallback marker | "⚙️ Compacted (28k → 830)" |
| `gateway-pr-head-manual-compact-generic-summary` | PR | `/compact`, unstructured fallback summary | 3 | 4 | same, plus `quality_guard_degraded_fallback` | yes, degraded | compacted |

The three primary 429s per run are `retryAsync` attempts inside `summarizeCompactionHistory`. The two fallback
requests are the history summary and the split-turn prefix summary.

`[compaction-diag] end … reason=guard_blocked` appears on both builds for the primary attempt. That label is
the separate issue openclaw/openclaw#194759 and is unchanged by this PR, as intended.

### Redacted log excerpts

PR head, budget-triggered (`runs/gateway-pr-head/excerpt.txt`):

```text
[provider-transport-fetch] [model-fetch] response provider=stuba api=openai-completions model=m status=429 contentType=application/json requestNumber=1
[provider-transport-fetch] [model-fetch] response provider=stuba api=openai-completions model=m status=429 contentType=application/json requestNumber=2
[provider-transport-fetch] [model-fetch] response provider=stuba api=openai-completions model=m status=429 contentType=application/json requestNumber=3
[compaction-safeguard] Compaction summarization failed; cancelling compaction to preserve history.
[agent/embedded] [compaction-diag] end trigger=budget provider=stuba/m attempt=1 maxAttempts=1 outcome=failed reason=guard_blocked
[model-fallback/decision] decision=candidate_failed candidate=stuba/m reason=rate_limit status=429 code=429 next=stubb/m outcome=next_fallback
[model-fallback/decision] decision=candidate_succeeded candidate=stubb/m outcome=succeeded
```

`origin/main`, same scenario (`runs/gateway-origin-main/excerpt.txt`):

```text
[provider-transport-fetch] [model-fetch] response provider=stuba api=openai-completions model=m status=429 contentType=application/json requestNumber=1
[provider-transport-fetch] [model-fetch] response provider=stuba api=openai-completions model=m status=429 contentType=application/json requestNumber=2
[provider-transport-fetch] [model-fetch] response provider=stuba api=openai-completions model=m status=429 contentType=application/json requestNumber=3
[compaction-safeguard] Compaction summarization failed; cancelling compaction to preserve history.
[agent/embedded] [compaction-diag] end trigger=budget provider=stuba/m attempt=1 maxAttempts=1 outcome=failed reason=guard_blocked
[auto-reply/preflight-compaction] preflight compaction failed: Compaction safeguard could not summarize the session: Summarization failed for 6 messages: Summarization failed: 429 daily token quota exhausted | summarization_failed
```

Full redacted compaction/fallback log records: `runs/*/gateway-log-compaction-lines.jsonl`. Per-request stub
log: `runs/*/stub-requests.jsonl`. Redactions: hostnames, session keys, UUIDs, trace/span ids, diag ids, local paths.

## Comparison with the wr-web report

The [wr-web report](https://github.com/openclaw/openclaw/pull/194813#issuecomment-6713323856) (Windows 11, manual `/compact`)
listed 0 fallback requests on `main` `fc9749f` and 4 on `30ff6a5`, with the same `rate_limit` decision lines.
Direction and classification agree here on a second OS, for both the budget and manual triggers.
The count differs (2 vs 4) only because of stub summary content: with an unstructured fallback summary
(`STUB_GENERIC_SUMMARY=1`) the same PR build makes exactly 4 fallback requests, since the quality guard
retries both summary calls once and then commits a degraded summary.

## Unit, type and lint checks (`unit/`)

| Check | Command | Result |
| --- | --- | --- |
| PR tests | `pnpm test src/agents/embedded-agent-runner/compact-reasons.test.ts src/agents/embedded-agent-runner/compact.hooks.test.ts --maxWorkers=1` | 10 + 88 passed |
| Red on main | `main` + only the new table row: `pnpm test src/agents/embedded-agent-runner/compact.hooks.test.ts --maxWorkers=1 -t "keeps model fallback boundaries"` | 1 failed (quota 429 row: requested `[summary-primary]`, expected `[summary-primary, summary-backup]`; `failure` = `{code: summarization_failed, rawError: …}`, no status or reason), 5 passed |
| Typecheck | `pnpm tsgo:core` | passed |
| Lint | `pnpm lint:core` | no diagnostics in the three changed TypeScript files; the run exits 1 on pre-existing `max-lines` errors in unrelated files at this head |
| Lint, file-scoped | `node scripts/run-oxlint.mjs --tsconfig tsconfig.core.json <files>` | not reproducible here: oxlint reported "No files found to lint" in this shallow clone |
| Adjacent | `pnpm test src/agents/embedded-agent-runner/compact.summary-fallback.test.ts src/agents/failover-error.test.ts src/agents/embedded-agent-subscribe.handlers.compaction.test.ts src/agents/embedded-agent-runner/run.overflow-compaction.test.ts --maxWorkers=1` | 17 + 53 + 9 passed, including refused-summary trimming for manual and budget triggers |

## Not covered

- Live-model-provider proof. Every run used loopback stubs, so no real provider's quota response was exercised.
- Providers that signal quota only through `errorType` or the error body with no HTTP status in the message; see the review note in the PR comment.

## Reproduce

```sh
node scripts/worktree-setup.mjs gateway
node --import ./scripts/tsx.mjs <bundle>/harness/drive.mts "$PWD" <out-dir> <label>
# manual variant: STUB_MANUAL_COMPACT=1 STUB_MAX_TURNS=2; unstructured fallback summary: STUB_GENERIC_SUMMARY=1
node <bundle>/harness/inspect-state.mjs <out-dir>
<bundle>/harness/excerpt.sh <out-dir>
```
