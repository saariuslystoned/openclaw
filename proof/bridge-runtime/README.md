# Changed-runtime proof: the PR's Google bridge against the live Gemini API

`bridge-proof-driver.mts` creates the bridge exactly as the Gateway relay does
(`buildGoogleRealtimeVoiceProvider().createBridge(...)` with the `openclaw_agent_consult`
tool, model `gemini-3.8-live-extended-thinking`, thinkingLevel high) and logs every bridge
callback. Run from the PR checkout with `node --import ./scripts/tsx.mjs` and `GEMINI_API_KEY`.

| log | what it shows |
|---|---|
| `bridge-proof-final.jsonl` | final code. Consult: `onToolCall` → one `submitToolResult` (no interim, no scheduling) → spoken result → `onResponseDone completed`. Interrupt: `handleBargeIn` → `onClearAudio("barge-in")` +47 ms → `onResponseDone cancelled` +351 ms → a silent `<no speech>` turn → follow-up answered coherently. Mic silence streamed throughout, as a relay client does. |
| `bridge-proof-mic.jsonl` | earlier code (empty client turn): interruption confirmed (+55 ms / +540 ms) but the model resumed its task ~2.5 s later. |
| `bridge-proof.jsonl` | same, without the mic stream. |

Companion probe logs (`../probe/events-interrupt-*-{high,neutral}*.jsonl`) compare interrupt
signals at thinking level high: an empty client turn is followed by the model resuming in
3/3 neutral runs; the bracketed user turn used by the final code stayed silent in 2/3 neutral
runs and in 2/4 runs of a prompt that told the model not to stop. Extended Thinking can still
resume on its own after any interrupt; server-side VAD interrupts it again when the user speaks.
