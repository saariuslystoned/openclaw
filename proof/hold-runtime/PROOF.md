# Runtime proof: the consult transcript hold engages on the real client consult path

PR: openclaw/openclaw#152428 (`fix/talk-relay-consult-transcript-hold`).
Date: 2026-09-19, 00:40 to 01:15 America/New_York. Cockpit: this Mac, headless.

## Setup

| item | value |
|---|---|
| gateway | built with `pnpm build` from the PR worktree at its exact head (`OpenClaw 2026.9.4 (9bde399)`, source identical to the pushed commit apart from test-only amends); isolated config `openclaw.json5` (this folder, token redacted), own state dir, loopback plain ws on port 18998, `logging.level: debug` |
| Talk config | provider google, mode realtime, transport gateway-relay, brain agent-consult; agent model google/gemini-3.7-flash |
| client | `relay-hold-scout.mts` (this folder): a Node client on the `GatewayClient` package that does what the Android/browser client does on the Google route: `talk.session.create` → streams 24 kHz PCM16 from macOS `say` through `talk.session.appendAudio` (then silence) → on the forwarded `toolCall` event calls `talk.client.toolCall` → waits for the run's `chat` final → `talk.session.submitToolResult` |
| question | "What is the current date and time on the gateway machine? Please check." |

## Runs

| run | model | result | hold lines (gateway file log, `gateway-hold-lines.jsonl`) |
|---|---|---|---|
| 1 (`scout-run1.jsonl`) | gemini-3.1-flash-live-preview (upstream default) | user final → `toolCall` → `talk.client.toolCall` ok (run `talk-fc_…`) → `chat` final "…Saturday, September 19, 2026, at 12:40 AM EDT…" → `submitToolResult` → spoken answer final | `hold begin (client)` depth 1 at 04:40:08.302Z; `hold release` held 0, heldMs 12659 at 04:40:20.961Z |
| 2 (`scout-run2.jsonl`) | same, with a `talk.realtime.instructions` line asking the model to say a filler before the tool call | same flow; the model spoke "One moment, let me check that for you." but delivered it as one final together with the answer, after the tool result | `hold begin (client)` at 04:41:56.916Z; `hold release` held 0, heldMs 6179 at 04:42:03.095Z |
| 3 | gemini-3.8-live-extended-thinking on the PR build | `Realtime provider error` ×4, session closed before ready: the Gemini 3.8 contracts fix (#152413) is not on this branch (expected) | none |
| 4, 5 (`scout-run4/5-gemini38-no-response.jsonl`) | gemini-3.8-live-extended-thinking on a combined build (PR head + cherry-picked #152413 contracts commit, throwaway worktree) | session ready, `turn.started` on the mic audio, then no transcript, tool call, or audio for 150 s with two different `say` voices. Not a hold issue (no consult was ever admitted); the earlier phone run on the combined build (`../phone-run/PROOF.md`) shows this model's pre-call filler being appended after the consult with real microphone speech | none |

| 6 (`scout-run6-forced-consult.jsonl`) | gemini-3.1-flash-live-preview with `consultRouting: "force-agent-consult"`, gateway rebuilt from the amended head (a6cc28f, replay waits for queue capacity) | two consults on the real path: the relay's forced consult (client submits the `working` result, `talk.client.toolCall`, run aborted by the relay when the model issued its own native call 2 s later) and the model's own `openclaw_agent_consult` (`chat` final "…1:53 AM EDT…", final tool result, spoken answer). The model spoke "I'm checking on that with OpenClaw" during the run, but this model delivers the transcript final only when the response ends, after the tool result | one `begin (client)` / `release` pair per consult, both `held: 0` (see the last four lines of `gateway-hold-lines.jsonl`) |

`grep -c "outside the current turn"` on the gateway log: 0 for every run.

## What this shows

- The hold is owned by the `talk.client.toolCall` entrypoint on the Google route: the
  `begin (client)` line lands when the RPC arrives (before the flush and before `chat.send`),
  and the `release` line lands when the relay sees the run settle through the client's
  final `talk.session.submitToolResult` (12.7 s and 6.2 s windows).
- `held: 0` on Gemini 3.1: this model produces its assistant transcript final only after the
  response ends, which is after the tool result on every run here (including the forced
  consult where it audibly said "I'm checking"), so nothing arrives inside the window. A held
  final inside the window needs Gemini 3.8's split filler final, which only answered a real
  microphone (phone run) in this campaign. The held-and-replayed path (including 42 held
  finals with a 40-slot queue, replay ordering, close, run-bound release) is covered by
  `src/gateway/talk/relay/voice.test.ts` and `src/gateway/talk/handlers/client-consult-hold.test.ts`
  (the latter drives the real handler and a real relay session with a final injected
  inside `chat.send`).

Redaction: home paths replaced with `~`, token redacted; no keys or IP addresses appear.
