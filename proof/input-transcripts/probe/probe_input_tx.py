#!/usr/bin/env python3
"""
Probe: what does a Gemini Live model send for inputTranscription (finished flag, chunking,
ordering vs model turn / interactionStatus boundaries)? Headless: macOS `say` -> 16 kHz PCM
streamed like a mic with silence between utterances. Every server message is dumped (audio
bytes replaced by their length) to events-<tag>.jsonl.

Usage: .venv/bin/python3 runs/<run>/probe/probe_input_tx.py --model M --tag T [--thinking low|none]
Needs the swarm-intercom .env (loaded by live_coder); the key is never printed.
"""
import argparse, asyncio, json, os, subprocess, sys, tempfile, time, wave
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))
import live_coder  # noqa: E402,F401
from google import genai  # noqa: E402
from google.genai import types  # noqa: E402

SECRETS = [v for v in (os.environ.get("GEMINI_API_KEY"), os.environ.get("GOOGLE_API_KEY")) if v]
IN_RATE, CHUNK_MS = 16000, 32
CHUNK_BYTES = IN_RATE * 2 * CHUNK_MS // 1000
T0 = time.time()
UTTERANCES = json.loads(os.environ["PROBE_UTTERANCES"]) if os.environ.get("PROBE_UTTERANCES") else [
    "Hello there. Please tell me, in one short sentence, what color the sky usually is on a clear day.",
    "Thanks. Now name one fruit that is yellow, and keep it short.",
    "Hey Gemini, what's on my calendar tomorrow?",
]
TOOL = types.FunctionDeclaration(
    name="lookup_calendar",
    description="Looks up the person's calendar for a given day and returns the events.",
    behavior=types.Behavior.NON_BLOCKING,
    parameters={"type": "OBJECT", "properties": {"day": {"type": "STRING"}}, "required": ["day"]},
)
FINAL = {"result": "Tomorrow: dentist at ten in the morning, then lunch with Sam at noon."}


def scrub(s):
    for v in SECRETS:
        s = s.replace(v, "<key>")
    return s


def synth(text):
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "u.wav"
        subprocess.run(["/usr/bin/say", "-o", str(p), "--data-format=LEI16@16000", text], check=True)
        with wave.open(str(p), "rb") as w:
            return w.readframes(w.getnframes())


def strip_audio(obj):
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k == "data" and isinstance(v, (bytes, str)) and len(v) > 64:
                out[k] = f"<{len(v)} bytes>"
            else:
                out[k] = strip_audio(v)
        return out
    if isinstance(obj, list):
        return [strip_audio(x) for x in obj]
    return obj


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--thinking", default="none")
    ap.add_argument("--gap", type=float, default=9.0, help="seconds between utterance starts after the reply turn completes")
    a = ap.parse_args()
    out = Path(__file__).resolve().parent
    ev = open(out / f"events-{a.tag}.jsonl", "w")
    mic: asyncio.Queue = asyncio.Queue()
    done = asyncio.Event()
    turn_complete = asyncio.Event()

    def log(kind, **data):
        rec = {"t": round(time.time() - T0, 3), "kind": kind, **data}
        line = scrub(json.dumps(rec, default=str))
        ev.write(line + "\n"); ev.flush()
        if kind not in ("audio_part", "raw"):
            print(line[:400], flush=True)

    cfg = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        **({} if a.thinking == "none" else {"thinking_config": types.ThinkingConfig(thinking_level=getattr(types.ThinkingLevel, a.thinking.upper()))}),
        system_instruction="You are a test voice. Keep answers to one short sentence.",
        tools=[types.Tool(function_declarations=[TOOL])],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )
    client = genai.Client()
    log("connect", model=a.model, thinking=a.thinking)
    async with client.aio.live.connect(model=a.model, config=cfg) as session:
        # Raw wire tap: the SDK drops fields it does not model, so log every frame as sent.
        orig_recv = session._ws.recv

        async def tapped_recv(*args, **kwargs):
            raw = await orig_recv(*args, **kwargs)
            try:
                log("raw", frame=strip_audio(json.loads(raw)))
            except Exception as e:  # non-JSON frame
                log("raw_unparsed", type=type(e).__name__, n=len(raw))
            return raw

        session._ws.recv = tapped_recv
        async def mic_sender():
            silence = bytes(CHUNK_BYTES)
            while not done.is_set():
                try:
                    chunk = mic.get_nowait()
                except asyncio.QueueEmpty:
                    chunk = silence
                await session.send_realtime_input(audio=types.Blob(data=chunk, mime_type=f"audio/pcm;rate={IN_RATE}"))
                await asyncio.sleep(CHUNK_MS / 1000)

        async def receiver():
            try:
                while not done.is_set():
                    async for m in session.receive():
                        d = strip_audio(m.model_dump(exclude_none=True, mode="json"))
                        sc = d.get("server_content") or {}
                        parts = (sc.get("model_turn") or {}).get("parts") or []
                        if parts and all("inline_data" in p for p in parts) and len(sc) == 1:
                            log("audio_part", n=len(parts))
                            continue
                        log("msg", msg=d)
                        if sc.get("turn_complete"):
                            turn_complete.set()
                        if m.tool_call:
                            for c in m.tool_call.function_calls:
                                async def respond(c=c):
                                    await asyncio.sleep(2.0)
                                    log("send_tool_response", id=c.id)
                                    await session.send_tool_response(function_responses=[types.FunctionResponse(id=c.id, name=c.name, response=FINAL)])
                                asyncio.create_task(respond())
            except Exception as e:
                log("error", type=type(e).__name__, message=scrub(str(e))[:400])
            finally:
                done.set()

        recv = asyncio.create_task(receiver())
        snd = asyncio.create_task(mic_sender())
        await asyncio.sleep(1.0)
        for u in UTTERANCES:
            if done.is_set():
                break
            turn_complete.clear()
            pcm = synth(u)
            for i in range(0, len(pcm), CHUNK_BYTES):
                mic.put_nowait(pcm[i:i + CHUNK_BYTES])
            log("say", text=u, ms=len(pcm) * 1000 // (IN_RATE * 2))
            try:
                await asyncio.wait_for(turn_complete.wait(), timeout=25)
            except asyncio.TimeoutError:
                log("no_turn_complete_within", s=25)
            await asyncio.sleep(a.gap)
        log("end")
        done.set()
        snd.cancel(); recv.cancel()
    ev.close()


asyncio.run(main())
