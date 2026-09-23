# Extended Thinking interaction lifecycle: before/after runtime trace (live Gemini API, 2026-09-23)

`lifecycle-proof-driver.mts` creates this checkout's Google bridge exactly as the Gateway relay does
(`buildGoogleRealtimeVoiceProvider().createBridge(...)`, `openclaw_agent_consult` tool,
`gemini-3.8-live-extended-thinking`, thinkingLevel high, noise-floor microphone streamed throughout) and
logs every bridge callback **and every server frame on the wire** (audio payloads stripped to byte
counts), so each `turnComplete` is shown next to its `interactionStatus` and next to what the bridge did.
The `.log` files omit the per-frame `audio` records; the `.jsonl` files are complete. No secrets appear
in either. Run from the checkout root with `GEMINI_API_KEY` set:
`node --import ./scripts/tsx.mjs lifecycle-proof-driver.mts <out.jsonl>`.

| run | head | filler `turnComplete` (`IN_PROGRESS`) | consult answer | barge-in |
|---|---|---|---|---|
| `before-7baeca4d7c7.*` | parent, before the lifecycle commit | bridge emitted `onResponseDone completed` at the filler, **before** the `toolCall` arrived (and again at a second filler) | `completed` at `IDLE` | `onClearAudio` +76 ms, `onResponseDone cancelled` +250 ms |
| `after-5d3ff700eba.*` | PR head | **no** `onResponseDone` at the filler; interaction stays active until the consult answer | `completed` at the `turnComplete` carrying `interactionStatus: IDLE` | `onClearAudio("barge-in")` +52 ms, `onResponseDone cancelled` +322 ms, 8 audio bytes after |

Key lines from `after-5d3ff700eba.log` (t_ms from connect):

```
 3930  wire   turnComplete interactionStatus=IN_PROGRESS   (spoken filler "Let me check on that.")
11228  wire   toolCall openclaw_agent_consult               <- no onResponseDone in between
11228  check-filler  onResponseDone_before_toolCall=[]  interaction_left_active=true
14229  submitToolResult final, scheduling none
22084  wire   turnComplete interactionStatus=IDLE
22084  onResponseDone completed
40175  handleBargeIn -> 40226 wire interrupted + onClearAudio("barge-in") -> 40496 onResponseDone cancelled
```

The same checks in `before-7baeca4d7c7.log`: `onResponseDone_before_toolCall=["completed"]`,
`interaction_left_active=false`. Both runs finished with a coherent follow-up answer and a clean close.
