# Restack onto main 5ef36706caa (#150283 merged), 2026-09-19

Stack rebased onto origin/main 5ef36706caa (includes #150283, the #150530 consult-fence repair). Commit diffs unchanged.

- #152413 73b3ddbb299, #152680 6c514457ac5, #152844 320ad18fcfc
- `checks-stack-rebased.log`: vitest (google realtime + thinking), `pnpm tsgo:extensions`, `check-changed --base <parent>`, line-cap ratchet in each worktree: all exit 0.
- #150283's `src/gateway/talk/relay/relay-consult-adoption.regression.test.ts` on the #152844 head (all three commits): 11/11 pass.
- Live bridge driver (`../input-transcript-proof-driver.mts`, noise floor) on 6c514457ac5: gemini-3.8-live-extended-thinking and gemini-3.8-live each 3 user finals during the call, 3 replies.
- Zero-silence runs on 320ad18fcfc: `../../../audio-stream-end-silence/bridge-after/rebased-on-5ef36706caa/`, both 3.8 models 3/3 replies, 3 user finals.
