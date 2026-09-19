# Phone run: nonempty hold on the real client consult path (Pixel 11 Pro Fold, Gemini 3.8)

Date: 2026-09-19 02:30 America/New_York (06:30 UTC). Cockpit: this Mac, headless ADB captures
via the phone-proof helper. Human at the phone: Bobby (was speaking near it after the consult).

| item | value |
|---|---|
| gateway | combined proof build: PR head `776b04fe28b` + cherry-picked #152413 contracts commit (`OpenClaw 2026.9.4 (ffa9e1a)`), isolated config `../openclaw.json5` (token redacted), own state dir, loopback plain ws on 18998, `logging.level: debug` |
| Talk config | provider google, mode realtime, transport gateway-relay, model `gemini-3.8-live-extended-thinking`, thinkingLevel high; agent model google/gemini-3.7-flash |
| phone | Pixel 11 Pro Fold, `ai.openclaw.app.debug` 2026.8.2-debug (same APK as the earlier 10 Pro Fold run), inner display (physical id `4619827677550801152`, logical 0), reached over `adb reverse tcp:18998`, paired with `openclaw devices approve` / `nodes approve` |
| speech input | macOS `say` through the Mac speaker next to the phone: "What is the current date and time on the gateway machine? Please check." |
| relay session | `77dd0491-7076-4f5d-9601-88237e5c74f4` |

## Consult window (`gateway-events-consult-window.jsonl`, gateway file log)

| UTC | event |
|---|---|
| 06:31:07.388 | assistant final "Let me check that for you." (before the tool call; store row 14) |
| 06:31:08.805 | `tool.call` (the model calls `openclaw_agent_consult`; relay forwards it to the app) |
| 06:31:08.820 | **`realtime relay transcript hold begin (client)` depth 1** (app called `talk.client.toolCall`) |
| 06:31:15.340 | assistant final "I am currently querying the gateway machine to get the exact date and time." spoken **inside the window**: held |
| 06:31:17.216 | `tool.result` (app submitted the run's final answer) |
| 06:31:17.223 | **`realtime relay transcript hold release` held 1, heldMs 8404** |
| 06:31:28 | spoken answer final "…Saturday, September 19, 2026, at 2:31 AM Eastern Daylight Time…" |

`grep -c "outside the current turn"` on the gateway log: 0.

## Durable replay (`session-store-rows.txt`, `session_transcript_fts` of the isolated agent store)

| row | role | UTC | text |
|---|---|---|---|
| 14 | assistant | 06:31:07 | Let me check that for you. |
| 15 | user | 06:31:09 | the consult's keyed user turn (adopted by the run; no adoption error) |
| 16 | assistant | 06:31:17.034 | the consult run's answer |
| 17 | assistant | 06:31:17.215 | the held final "I am currently querying…", appended by the replay right after release, behind the run |
| 18 | assistant | 06:31:28 | the spoken answer |

The app's own transcript view (`16-after-question.png`, `17-talk-transcript-texts.json`) shows the
same three assistant lines in order; `18-ended.png` shows Talk ended cleanly (`session.closed`).

Note: after the consult, ambient speech near the phone (the human talking) produced further turns
(rows 19 onward, one `turn.cancelled`); they are outside the window above and were left out.
Redaction: no serial, token, key, or IP in this folder; the app header shows the pairing device id.
