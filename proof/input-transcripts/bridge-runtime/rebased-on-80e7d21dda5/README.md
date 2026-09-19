# Restack onto main 80e7d21dda5 (#150536 merged), 2026-09-19

Stack rebased onto origin/main 80e7d21dda5, which now carries both #150530 repairs: #150283 (keyed-input adoption, 5ef36706caa) and #150536 (prepared-answer retention after late speech finalization). Commit diffs unchanged.

- #152413 6c34ffcc36e, #152680 3d14a357c99, #152844 9d8bf63d961
- `checks-stack.log`: vitest (google realtime + thinking), `pnpm tsgo:extensions`, `check-changed --base <parent>`, line-cap ratchet in each worktree: all exit 0 (115 / 118 / 121 tests).
- `consult-tests.log`: on the #152844 head (all three commits) 38/38 pass across #150536's `src/talk/voice-consult-transcript-race.test.ts` and `src/talk/agent-consult-runtime.test.ts` plus #150283's `src/gateway/talk/relay/relay-consult-adoption.regression.test.ts`. That covers the after-adoption speech write ClawSweeper asked about: user speech persisted after consult adoption no longer loses the prepared answer.
- Live bridge driver (noise floor) on 3d14a357c99: both 3.8 models, 3 user finals during the call, a reply per utterance.
- Zero-silence runs on 9d8bf63d961: `../../../audio-stream-end-silence/bridge-after/rebased-on-80e7d21dda5/`, both 3.8 models 3/3 replies, 3 user finals.
