# Real relay proof: unconfirmed client cancellation keeps the session open (openclaw#152427)

Gateway: `OpenClaw 2026.9.4 (e4ffbbb)`, built from `fix/talk-relay-cancellation-recovery` at
`e4ffbbb328c` (the 152427 commit alone; the provider interrupt from #152413 is **not** in this
build, so Google has no way to confirm the cancel and the 1 s drain deadline must fire). Isolated
state/config, TLS on loopback. Provider `google`, model `gemini-3.1-flash-live-preview`, transport
`gateway-relay`, brain `agent-consult`.

Client: [`cancel-client.mts`](cancel-client.mts), a headless operator client using the repo's
`@openclaw/gateway-client`. It streams 24 kHz PCM16 continuously (speech from macOS `say`, silence
otherwise, 20 ms frames, like the phone/Control UI), waits for 25 reply audio frames, calls
`talk.session.cancelOutput` with the live `turnId`, keeps streaming for 8 s, then asks a second
question. Audio bytes, token, and key are never logged.

## What the log shows ([events](events-gemini-3.1-flash-live-preview.jsonl), [gateway excerpt](gateway-excerpt.log))

| t (ms) | event |
|---:|---|
| 330 | `session.ready` |
| 8076 | user transcript turn-1: "Please tell me a long, detailed story about a lighthouse keeper…" |
| 8996 | first reply audio / transcript on turn-1 |
| 9206 | `talk.session.cancelOutput` sent (turn-1, 46 audio frames received) |
| 9209 | `clear` / `turn.cancelled` for turn-1 |
| 10217 | RPC answers `{ ok: true, status: "applied", turnId: "turn-1" }`, **latency 1011 ms** (gateway: 1009 ms) |
| gateway 00:18:38.084 | `talk relay: provider did not confirm output cancellation within 1000ms; keeping the session open and discarding stale output (reason=headless-proof-stop, turnId=turn-1)` |
| 10217–18219 | **0** turn-1 audio frames reach the client after the RPC although Google keeps generating the story (`cancelledTurnAudioFramesAfterResult: 0`) |
| 19886 | Google server VAD interrupts the still-live stale generation when the second question starts (`clear`, reason `barge-in`, turn-1): the fence held that generation for ~10 s |
| 22003 | user transcript turn-2: "What is 2 + 2? Answer in one short sentence." |
| 23903 | turn-2 reply audio begins: "Two plus two is four. …" (1477 audio frames) |
| 31949 | session closed by the client (`reason: completed`), never by the relay |

Before this change the same deadline called `closeRelaySession` (see `operations.ts` on main), so
the session would have ended at ~10.2 s.

## Notes

- Model-side continuation: after answering "Two plus two is four." Gemini went on with the
  story in the new turn. That is the model's own context (Google was never told the user stopped
  it, since the provider cannot cancel), not relay leakage: it is a fresh generation after the
  turn-2 user transcript. #152413 adds the provider-side interrupt that tells Google.
- `gemini-3.8-live` and the default `gemini-3.8-live-extended-thinking` were tried on this
  build too. 3.8 support is part of #152413, so without it the 3.8 models produced no input
  transcripts / a provider error at setup. No cancellation was reached, so those runs are not
  evidence either way and are not included.
- The 30 s stale-fence watchdog (fail + reconnect, never admit) is covered by unit tests only.
  A live provider always ended the stale generation well inside the bound.
