# Gateway proof for the #194915 fix

An isolated source Gateway runs from each build, with throwaway state on a loopback port. It uses one healthy loopback stub summarizer as the primary (`dryfallback/m`, OpenAI-compatible), with no fallback. No real model is used.

| | |
| --- | --- |
| Base | `c61a7c0cf` (`main`) |
| Fix | `1c51376f` |
| OS | macOS 26.5.2 |
| Driver | Node v24.22.1 |
| Gateway runtime | Bun 1.4.4 |

## Steps

1. Use the default `contextInjection`, so every completed run appends the `openclaw:bootstrap-context:full` marker. Turn off `compaction.qualityGuard` and `compaction.memoryFlush`.
2. Seed eight `chat.send` turns of about 5.8k characters each.
3. Send `/compact`.
4. Count the summary requests in the stub's request log, and read the compaction entry back from the throwaway transcript, read-only.

The commands are below. Each pair runs once per checkout, with its own output directory and stub process.

```bash
LIVE_PRIMARY=dryfallback/m LIVE_CONTEXT_INJECTION=default LIVE_KEEP_RECENT_TOKENS=3000 \
  node --import ./scripts/tsx.mjs <proof>/harness/live-drive.mts "$PWD" <out> config '[]'
# same env, then the "seed 8" phase, then the "compact" phase
```

## Results

| Cut | Build | Summary requests | Split-turn section saved | First kept entry |
| --- | --- | ---: | --- | --- |
| User message after a marker (`keepRecentTokens: 3000`) | base | 2 (44,298 and 8,228 bytes) | yes | 31, the marker |
| User message after a marker (`keepRecentTokens: 3000`) | fix | 1 (44,298 bytes) | no | 31, the marker |
| Inside the last turn (`keepRecentTokens: 1000`) | base | 2 | yes | 34, the assistant |
| Inside the last turn (`keepRecentTokens: 1000`) | fix | 2 | yes | 34, the assistant |

- **Rows 1 and 2:** the defect and its fix. Both builds keep the marker as the first kept entry. Only the base build re-summarizes the previous complete turn (entries 28 to 30) as a split-turn prefix.
- **Rows 3 and 4:** a genuine mid-turn cut is unchanged by the fix.

Each `result.json` lists the transcript entry kinds around the cut. `stub-requests.jsonl` has one line per stub request, without bodies.
