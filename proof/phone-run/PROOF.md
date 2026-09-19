# S4 phone proof: Gemini 3.8 Live Extended Thinking over gateway-relay from the Pixel 10 Pro Fold

Date: 2026-09-18 evening (America/New_York). Cockpit: this Mac. Human mirror: Android Studio
Running Devices (Bobby watching). Agent proof: phone-proof ADB captures + gateway logs + the
gateway's session store.

## Surface

| item | value |
|---|---|
| gateway | built from fork branch `feat/gemini-3.8-live-relay` (2648df42e1b on upstream main e4f603b452b), `OpenClaw 2026.9.4 (2648df4)`, isolated state/config in `../gateway/`, LAN bind with TLS (auto-generated cert) and a throwaway token |
| Talk config | provider google, mode realtime, transport gateway-relay, model `gemini-3.8-live-extended-thinking`, thinkingLevel high; agent model google/gemini-3.7-flash |
| phone | Pixel 10 Pro Fold, Android 16, `ai.openclaw.app.debug` 2026.8.2-debug (built from v2026.9.3 on Sep 10), outer display, connected over Wi-Fi to <lan-ip>:18999 with Full access; CP-1 entry kept |
| speech input | macOS `say` through the Mac speaker next to the phone |
| relay session | `81861268-e7fe-42bd-a687-78645e96a85c`, started 22:11:53 |

## Steps

| # | contract | result | evidence |
|---|---|---|---|
| 1 | Settings → Voice shows Google via Gateway relay, Ready | **pass**: "Realtime Talk — Google Live Voice via Gateway relay — Ready" | `01-voice-readiness.png` + `.json` |
| 2 | plain turn answered by voice, Talk stays active | **pass**: transcript "Hello! Yes, I can hear you clearly…"; app shows End Talk (active) | `02-talk-started.png`; session store `session_transcript_fts` rowid 1–7 |
| 3 | agent consult answered by voice, no adoption error | **pass**: `tool.call` → `tool.result` → spoken "The current time on the gateway machine is 10:13 PM EDT on Friday, September 18th, 2026."; the pre-call filler "Let me quickly verify that for you." was appended after the consult; no "keyed user is outside the current turn", no `isError` | gateway log 22:12–22:13; store rowids 8–11; `03-consult-answered.png` |
| 4 | voice barge-in stops a long count, session survives | **pass**: count reached "1…8", spoken "Stop" → `turn.cancelled`, next turn "Understood. Stopping the count now."; app still End Talk; no relay warnings | gateway log 22:14:28; store rowids 13–14 |
| 6 | follow-up coherence | **pass**: "I stopped counting at the number 9." | store rowid 15 |
| 7 | session past Gemini's ~10 min connection limit | **pass**: second relay session `0f6453e1…` started 22:19:59; turns at 22:24, 22:28 and 22:30:59 (11 min) all answered; at 11 min it recalled the color it named at 22:28 ("the color I named earlier was blue"); no goAway, resumption, or error lines; app still End Talk | `07-ten-minutes.png`; store rowids 22–29 |
| 5 | explicit stop mid-reply (cancelOutput path) | **partial**: the Android app has no stop control in relay mode; End Talk during a count (22:31:59, model at "1… 18…") closed the session cleanly (`session.closed`, no warnings) — an earlier accidental End Talk mid-reply at ~22:17 did the same. The relay's local-completion path for an unconfirmed cancel is covered by `cancellation-recovery.test.ts` and the provider interrupt by the S0 probe; a Control UI stop-button run was not performed | `05-before-stop.png`; gateway log 22:31–22:32 |

Notes:
- The gateway's own log (`/tmp/openclaw/openclaw-2026-09-18.log`, subsystem talk) carries only
  event metadata; transcript text comes from the agent session store copied while live.
- Provider events show `talkProvider: google`, `talkTransport: gateway-relay`, `talkBrain: agent-consult` on every line.
