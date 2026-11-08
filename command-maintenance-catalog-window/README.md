# Command-path maintenance budgets a large-window model at 200k

This folder is the evidence for the fix on branch `fix/command-maintenance-catalog-window`
(commit `44f8739d04bf4a4637a97dc0734b52452aca4ec3`). The fix is based on `main`
`b17b49094f6aa64e28148502a09fc2d324fff6ec`.

## Defect

Gateway `agent` method turns build their maintenance follow-up without the selected
route's model catalog. These turns include a subagent's completion announce into its
parent, descendant wakes and sessions_send. `resolveFollowupContextTokens` reads the
window only from that catalog, so a model whose window is not authored in config
resolves to the 200,000 default. The same budget drives the compaction threshold and
the pre-compaction memory flush.

A stored `resolved-v1` window for the exact provider, model, harness and auth pin can
hide the gap. Window-option models store `resolved` instead, so nothing hides it
there.

## Harness

- `harness/spawn-stub.mjs`: a zero-cost loopback OpenAI-compatible stub. It returns one
  `sessions_spawn` call on `SPAWN-FORK`, `CHILD-DONE` for the child, and structured
  summaries for compaction requests. Its log records request sizes and kinds only.
- `harness/spawn-drive.mts`: an isolated Gateway.
  - Throwaway HOME, state and config, an ephemeral loopback port, `--auth none`, and
    bundled plugins off.
  - The model windows come only from a throwaway local provider plugin's manifest
    catalog. Config has no `models.providers` rows.
  - `tools.toolSearch: false`, so the stub can call `sessions_spawn` directly.
  - Flow: seed the parent session to about 194k tokens, spawn one subagent, then wait
    for the completion announce to settle.

Run it with:

```bash
SE_MODEL=options SE_CONTEXT=fork node --import <checkout>/scripts/tsx.mjs harness/spawn-drive.mts <checkout> <outDir> <label>
```

## Results

| Run | Build | Model window | Summary requests after spawn | Parent announce request | Parent compactions |
| --- | --- | --- | ---: | ---: | ---: |
| `base-options-fork` | `main` | 1,048,576 default, 200k option | 1 | 57,954 tokens | 1 |
| `fix-options-fork` | fix | 1,048,576 default, 200k option | 0 | 196,150 tokens | 0 |
| `fix-small-fork` | fix | 200,000 (control) | 1 (at about 147k, before the spawn) | 80,827 tokens | 1 |
| `base-big-fork` | `main` | 1,048,576 plain | 0 | 196,127 tokens | 0 |

Notes on the runs:
- `base-big-fork` did not compact because the parent stored a `resolved-v1` window for
  the same route. See `session-provenance.json`.
- The fix runs used the fix's production diff before it was committed. The
  `checkoutHead` field in their `summary.json` therefore shows the base commit.
- `stub-requests.jsonl` holds timestamps, kinds, sizes, message counts and tool names
  only. It never holds prompts or replies.
