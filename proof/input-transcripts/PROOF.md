# Gemini 3.8 Live input transcripts: what the API sends, and the bridge before/after

Issue: openclaw/openclaw#152646. Fix: `fix/google-gemini-3-8-live-input-transcripts`
(saariuslystoned/openclaw), one commit (87ed0f9fdd4) stacked on #152413 (0d2e00b7bf9).
Captured 2026-09-19 against the live Gemini API from a Mac. Speech is macOS `say`, streamed as
32 ms microphone frames. No key or token appears in any file here.

## 1. Raw wire frames (`probe/`)

`probe_input_tx.py` opens one Live session per model and speaks three utterances: two plain
questions, then a calendar question that triggers a NON_BLOCKING tool call. It taps the
websocket before the SDK decodes each frame (`kind: "raw"`), because SDK 2.23 drops fields it
does not model. Audio payloads are replaced by their length.

| model                                                                                                                                | log                           | inputTranscription frames                      | `finished` present | other input signals     |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------- | ------------------ | ----------------------- |
| gemini-3.8-live-extended-thinking (thinkingLevel high)                                                                               | `events-g38et-high-raw.jsonl` | 3, one per utterance, each the whole utterance | never              | none (no voiceActivity) |
| gemini-3.8-live                                                                                                                      | `events-g38-raw.jsonl`        | 3, one per utterance                           | never              | none                    |
| gemini-3.8-live-extended-thinking, 16 s utterance with a 700 ms mid-sentence pause, then "Okay. [pause] And, um, [pause] how often…" | `events-g38et-long-raw.jsonl` | 2: the 16 s utterance arrives as one frame     | never              | none                    |
| gemini-3.8-live, same                                                                                                                | `events-g38-long-raw.jsonl`   | 2                                              | never              | none                    |
| gemini-3.1-flash-live-preview (control, SDK-decoded)                                                                                 | `events-g31.jsonl`            | 3, one per utterance                           | never              | voiceActivity START/END |

Every 3.8 frame arrives right before the first `modelTurn` or `toolCall` of the model turn it
prompts. That is the contract the provider already assumes for 3.1: each input transcription
message is a complete utterance with no `finished`. Across all key sets in the raw 3.8 frames
(`serverContent.{inputTranscription.text, outputTranscription.text, modelTurn,
generationComplete, turnComplete, interactionStatus}`, `toolCall`, `usageMetadata`,
`sessionResumptionUpdate`), no finality field appears.

## 2. The production bridge, before and after (`bridge-runtime/`)

`input-transcript-proof-driver.mts` builds the bridge exactly as the Gateway relay does
(`buildGoogleRealtimeVoiceProvider().createBridge(...)`, PCM16 24 kHz like the Android relay
client) and logs every callback. Between utterances it streams a microphone noise floor
(±8 LSB). The commit and whether `extensions/google` was swapped are logged in `createBridge`.

| run                  | code                               | user finals during the call                 | what the relay receives                                                                              |
| -------------------- | ---------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `before-g38et.jsonl` | #152413 head's `extensions/google` | **0** (3 partials)                          | one user final **at close**, all three utterances glued together ("…on a clear day?I want to plan…") |
| `before-g38.jsonl`   | same                               | **0** (4 partials)                          | same                                                                                                 |
| `after-g38et.jsonl`  | this fix                           | **3**, each on arrival and before the reply | one user final per utterance, no partials                                                            |
| `after-g38.jsonl`    | this fix                           | **3**                                       | same                                                                                                 |

Before the fix, the relay gets nothing it can persist during the call. It persists voice
transcripts only when `final` is true, emits `transcript.done` from user finals, and schedules
forced consults from them (`src/gateway/talk/relay/session-create.ts`). That matches the phone
proof in the issue: 0 `transcript.done`, 0 voice user rows, and force-agent-consult inert on
3.8.

Seen in `before-g38.jsonl`, utterance 3: speaking while the previous reply was still playing
made server VAD cut the utterance into two frames ("Thanks." / "that is yellow and keep it
short."), and the model answered each one. With the fix, each frame becomes its own user final,
matching the model's two turns. Gemini 3.1 already behaves this way.

## 3. Side finding (not changed here)

`prior/before-g38*.jsonl`: when the driver streamed digital zeros between utterances, 3.8
never answered. It also merged utterances into one late frame. `GoogleRealtimeVoiceBridge.sendAudio`
treats exactly-zero PCM as silence, sends `audioStreamEnd` after 500 ms, and then stops
forwarding silence. 3.8's server VAD then never sees trailing audio to close the turn. A phone
microphone's noise floor never trips this, which explains the earlier "3.8 gives no response to
synthesized audio headlessly" note from the relay scout. This is a separate issue for clients
that gate their microphone to true zeros.

## Checks

- `vitest run extensions/google/realtime-voice-provider.test.ts extensions/google/realtime-voice-provider.gemini38.test.ts extensions/google/thinking.test.ts`: 118 passed on the stacked branch. The two new 3.8 bridge tests fail against the old `isGemini31LiveModel` gate: 2 failed / 8 passed.
- `node scripts/check-changed.mjs` against both #152413 head and `origin/main`: exit 0 (`checks/`). `pnpm tsgo:extensions`: exit 0.
- The pre-fix runs swap in `extensions/google` from 0d2e00b7bf9 (`extensionsGoogleDirty: true`). The after runs are on 87ed0f9fdd4 with a clean tree.
