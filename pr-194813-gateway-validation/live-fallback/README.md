# Live fallback check for openclaw/openclaw#194813

One real model completion, approved by the owner of the signed-in account. Run on 2026-11-08 at 01:25Z.

| | |
| --- | --- |
| PR commit | `30ff6a55d5b755cf4f677b9a579e684c72f7282e` |
| OS | macOS 26.5.2 (25F84) |
| Driver | Node v24.22.1 |
| Gateway runtime | Bun 1.4.4 (`scripts/run-node.mjs gateway run`, loopback, throwaway state, ephemeral port) |

## Real versus replayed

- **Real:** the Gateway from the PR build, and the fallback. The fallback is a Google Gemini model reached through a provider plugin signed in to the owner's account. Its single summarization request is the one real completion. Its provider and model ids are redacted to `<provider-b>/<model-b>`.
- **Replayed:** the primary. There is no zero-cost way to confirm that a model's daily bucket is already used up, because the provider exposes no usage endpoint for this quota. So the primary is a loopback stub that speaks the Google Generative Language API to OpenClaw's own Google transport (`api: "google-generative-ai"`). For every summary request it returns HTTP 429 with the `RESOURCE_EXHAUSTED` body shape captured from a real daily-quota 429 on 2026-11-07, with the plan name, quota figure and model id removed (`harness/live-stubs.mjs`).

## Steps

1. Start the replay stub. Write the config with primary `replay/model-a` and no fallbacks.
2. Install the provider plugin into the throwaway state. Seed eight turns over `chat.send`. All eight went to the replay stub. No credential existed yet, so no real request was possible.
3. Stop the Gateway. The owner signed in from their own terminal. The credential was never read.
4. Add the single fallback `<provider-b>/<model-b>`, start the Gateway, and send `/compact`.
5. Stop the Gateway.

## One request per candidate

These throwaway-config settings make one fallback summary request. They were proven first in a zero-cost dry run with a stub fallback (`dry-run/`):

- `compaction.qualityGuard.enabled: false`, so no corrective retry.
- `compaction.memoryFlush.enabled: false`.
- `compaction.keepRecentTokens: 1000`, so the cut lands on a user message.
- `contextInjection: "never"`. Without it, a per-run bootstrap marker entry turns the previous complete turn into a split-turn prefix, which costs a second summary request (`split-turn-dry-run/`). That behavior predates this PR, and `split-turn-repro/` has a failing unit test for it.

## Result

| Run | Primary (replay) summary 429s | Fallback summary requests | Compaction |
| --- | ---: | ---: | --- |
| dry run, stub fallback | 3 | 1 (stub log) | persisted, `Compacted (26k → 2.0k)` |
| live, real fallback | 3 | 1 real completion | persisted, `Compacted (26k → 2.0k)`, summary 2,388 chars |

The live count rests on two facts. The live log shows one `candidate_succeeded` for the fallback and no failed request for it. The dry run, with the same config and seeded history, shows exactly one fallback request in the stub's request log.

Files:

- `live/compact-log-excerpt.txt`: provider errors, the safeguard cancellation, `compaction-diag`, fallback decisions and the `/compact` reply.
- `live/compact-summary.json`: replay stub requests during `/compact`, the compaction entry (tokens before, summary length) and model snapshots.
- `dry-run/`: the same files for the dry run.
