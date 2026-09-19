# Gemini 3.8 Live never ends a turn after the Google bridge stops sending silence

Captured 2026-09-19 against the live Gemini API. The Google bridge code involved
(`sendAudio`, `isPcm16Silence`) is identical on openclaw main d804b08da0e and on the branch
these runs used (87ed0f9fdd4).

## Production bridge (`bridge/`)

`input-transcript-proof-driver.mts` speaks three utterances (macOS `say`, PCM16 24 kHz,
32 ms frames). Between utterances it sends either exact-zero frames (`MIC_SILENCE=zeros`) or a
±8 LSB noise floor.

| run                 | silence between utterances | model replies                 | user transcripts                   |
| ------------------- | -------------------------- | ----------------------------- | ---------------------------------- |
| `zeros-g38et.jsonl` | exact zeros                | **0 / 3** (40 s timeout each) | 1, late, several utterances merged |
| `zeros-g38.jsonl`   | exact zeros                | **0 / 3**                     | 1, late, merged                    |
| `zeros-g31.jsonl`   | exact zeros                | 3 / 3                         | 3                                  |
| `noise-g38et.jsonl` | noise floor                | 3 / 3                         | 3                                  |
| `noise-g38.jsonl`   | noise floor                | 3 / 3                         | 3                                  |
| `noise-g31.jsonl`   | noise floor                | 3 / 3                         | 3                                  |

## Raw API, isolating the cause (`probe/`, `probe_input_tx.py --silence-mode`)

| mode     | what the client does after speech                                        | 3.8 Live                                    | 3.8 Live Extended Thinking | 3.1   |
| -------- | ------------------------------------------------------------------------ | ------------------------------------------- | -------------------------- | ----- |
| `stream` | keeps sending zero frames                                                | 3 / 3 turns complete                        | 3 / 3                      | —     |
| `end`    | zeros for 500 ms, `audioStreamEnd`, then nothing (the bridge's behavior) | **0 / 3** (no inputTranscription, no reply) | **0 / 3**                  | 3 / 3 |
| `stop`   | zeros for 500 ms, then nothing, no `audioStreamEnd`                      | **0 / 3**                                   | **0 / 3**                  | —     |

Gemini 3.1 treats `audioStreamEnd` as the end of the user's turn. Gemini 3.8 ignores it: the
server VAD only detects the end of speech while trailing audio keeps arriving, and 500 ms of
trailing silence is not enough. (`count(no_turn_complete_within)` in each events file = turns
the model never closed within 25 s.)

## After the fix (`bridge-after/`, fix/google-gemini-3-8-live-audio-stream-end @ 91eb5a9986c)

The same driver with `MIC_SILENCE=zeros`. On 3.8 the bridge now forwards every silent frame
and never sends `audioStreamEnd`; 3.1 keeps ending the stream after 500 ms.

| run | model replies | user finals during the call |
|---|---|---|
| `zeros-g38et.jsonl`, `zeros-g38et-2.jsonl`, `zeros-g38et-3.jsonl` | 3 / 3 each | 3 each |
| `zeros-g38.jsonl` | 3 / 3 | 3 |
| `zeros-g31.jsonl` (unchanged path) | 3 / 3 | 3 |

`zeros-g38et.jsonl` also logged a server `goAway` (300 s left) at 89 s. The provider already
reports this as `onError`, and the session continued to a clean close. The two reruns saw none.
