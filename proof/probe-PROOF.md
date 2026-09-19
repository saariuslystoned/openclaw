# S0 probe: Gemini 3.8 Live protocol facts that OpenClaw's Google bridge gets wrong

Run 2026-09-19 from the swarm-intercom cockpit with `probe_38.py` (google-genai 2.23.0, headless,
macOS `say` audio streamed as a 16 kHz mic with silence between utterances). One fresh Live session per
variant. Raw evidence: `events-<variant>.jsonl`, `log-<variant>.txt`, `summary-<variant>.json` in this
directory. No key material appears in any file (values are scrubbed before logging).

## Results

| # | variant | model | what was sent | result |
|---|---|---|---|---|
| 1 | consult-openclaw | 3.8-live-extended-thinking | NON_BLOCKING tool; interim FunctionResponse `{will_continue, scheduling: WHEN_IDLE}` (OpenClaw's exact shape) | **session closed by Google: 1007 "Function response scheduling is not supported for this model."** 120 ms after the interim |
| 2 | consult-nosched-v2 | 3.8-live-extended-thinking | interim `{will_continue}` without scheduling, final 6 s later | no error; model speaks a "checking" filler, goes IDLE; **final result never spoken** (27 s of listening after the final) |
| 3 | consult-nosched-v2quick | 3.8-live-extended-thinking | same, final 2 s after the interim | same: final result never spoken |
| 4 | consult-final-only | 3.8-live-extended-thinking | no interim; one final response 6 s after the call, no scheduling | **works**: "Let me check your schedule for tomorrow." … result spoken in full; IN_PROGRESS during the wait, IDLE after |
| 5 | consult-final-only-long | 3.8-live-extended-thinking | same with a 25 s silent wait | **works**: status stays IN_PROGRESS for the whole wait, no filler, result spoken 1.2 s after the final |
| 6 | consult-openclaw-38live | gemini-3.8-live (no thinking config) | OpenClaw's exact shape (interim with scheduling + will_continue, final with scheduling) | **works**: result spoken; `interaction_status` never present |
| 7 | consult-openclaw-38live (first try) | gemini-3.8-live with `thinking_level: LOW` | setup | **1007 "Thinking level is not supported for this model."** at connect |
| 8 | interrupt-empty | 3.8-live-extended-thinking | while counting, `send_client_content(turns=None, turn_complete=True)` | **clean cancel**: `interrupted` +73 ms, `turn_complete` + IDLE +466 ms, zero audio after, no new generation |
| 9 | interrupt-text | 3.8-live-extended-thinking | while counting, client content user "Stop." with turn_complete | clean cancel, same shape as 8 |
| 10 | interrupt-vad | 3.8-live-extended-thinking | while counting, a spoken "Stop, that's enough." | server VAD cancel: `interrupted` ~340 ms after speech onset, 4 stale audio chunks in between |
| 11 | activity-start | 3.8-live-extended-thinking | while counting, `activity_start` with automatic VAD on (PR 137006's Google change) | **silently ignored**: no error, no `interrupted`, model kept counting to 35 (33 s of audio) |

Turn/idle shape on extended thinking (all consult runs): `generation_complete` → `turn_complete` with
`interaction_status: IN_PROGRESS` after the pre-call phrase; the tool call arrives after that turn boundary;
the final answer ends with `turn_complete` + `IDLE`. `turn_complete` is an utterance boundary, not idle.

## Conclusions for the fix

1. `gemini-3.8-live-extended-thinking` must get: NON_BLOCKING on the consult tool, **no `scheduling`**,
   **no interim "working" response** (a `will_continue` interim is accepted but the model then drops the
   call and never speaks the final), `thinkingLevel` (low|medium|high), and one final function response.
   The 25 s silent wait is fine.
2. `gemini-3.8-live` keeps OpenClaw's current async contract (interim + WHEN_IDLE + will_continue works)
   but must get **no thinking config at all**.
3. A provider-level barge-in for extended thinking exists and is proven: an empty client-content turn with
   `turnComplete: true`. Server VAD also interrupts when mic audio keeps flowing. `activityStart` with
   automatic VAD does nothing, so PR 137006's Google half is a no-op.
4. Nothing above needs Android app changes; the Android relay accepts any non-`gpt-live` model.
