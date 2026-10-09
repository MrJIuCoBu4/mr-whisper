"""OpenAI/whisper.cpp-compatible /inference endpoint backed by faster-whisper (CTranslate2).

The OpenWhispr fork spawns whisper.cpp's server and talks to it over HTTP: a multipart
POST to /inference with `file`, `language`, `response_format` and an optional `prompt`,
answering `{"text": ...}`. This service answers the same protocol, but with CTranslate2,
which runs large-v3-turbo considerably faster than whisper.cpp on the same CPU.

Run:  .venv\\Scripts\\python.exe server.py [--port 8085] [--model model] [--threads 8]
"""

import argparse
import json
import io
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = None
ARGS = None
# CTranslate2 is documented as thread-safe, but faster-whisper shares a tokenizer and
# feature extractor between calls; serialise inference to be safe.
INFER_LOCK = threading.Lock()


def log(*parts):
    print(f"[fw-server] {' '.join(str(p) for p in parts)}", flush=True)


def parse_multipart(body: bytes, boundary: bytes):
    """Minimal multipart/form-data parser — enough for this protocol.

    Returns {name: value} for plain fields and {name: (filename, bytes)} for files.
    """
    fields = {}
    delimiter = b"--" + boundary
    for chunk in body.split(delimiter):
        if not chunk or chunk in (b"--\r\n", b"--"):
            continue
        chunk = chunk.lstrip(b"\r\n")
        if b"\r\n\r\n" not in chunk:
            continue
        raw_headers, content = chunk.split(b"\r\n\r\n", 1)
        # A single CRLF belongs to the multipart framing; never strip more, or the last
        # bytes of a binary payload (audio) get eaten.
        if content.endswith(b"\r\n"):
            content = content[:-2]
        name = None
        filename = None
        for line in raw_headers.decode("utf-8", "replace").split("\r\n"):
            if line.lower().startswith("content-disposition"):
                for part in line.split(";"):
                    part = part.strip()
                    if part.startswith("name="):
                        name = part[5:].strip('"')
                    elif part.startswith("filename="):
                        filename = part[9:].strip('"')
        if name is None:
            continue
        fields[name] = (filename, content) if filename is not None else content.decode("utf-8")
    return fields


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # keep stdout clean
        pass

    def _send_json(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        # whisper.cpp's server answers its health check on /
        self._send_json({"status": "ok", "model": ARGS.model})

    def do_POST(self):
        if self.path.rstrip("/") not in ("/inference", "/v1/audio/transcriptions"):
            self._send_json({"error": "not found"}, 404)
            return

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        ctype = self.headers.get("Content-Type", "")
        if "boundary=" not in ctype:
            self._send_json({"error": "expected multipart/form-data"}, 400)
            return

        boundary = ctype.split("boundary=", 1)[1].strip().strip('"').encode()
        try:
            fields = parse_multipart(body, boundary)
        except Exception as exc:  # noqa: BLE001
            self._send_json({"error": f"bad multipart: {exc}"}, 400)
            return

        entry = fields.get("file")
        if not isinstance(entry, tuple) or len(entry) != 2:
            self._send_json({"error": "no file field"}, 400)
            return
        _, audio_bytes = entry
        # The app speaks whisper.cpp's dialect and sends "auto" for auto-detection;
        # CTranslate2 expects None for that.
        language = (fields.get("language") or "").strip() or None
        if language and language.lower() == "auto":
            language = None
        prompt = fields.get("prompt") or None

        started = time.time()
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name

            # segments is a generator — the work happens while it is consumed, so the
            # whole loop has to stay inside the lock.
            with INFER_LOCK:
                segments, info = MODEL.transcribe(
                    tmp_path,
                    language=language,
                    initial_prompt=prompt,
                    beam_size=ARGS.beam,
                    vad_filter=True,
                    condition_on_previous_text=False,
                )
                text = "".join(segment.text for segment in segments).strip()
            elapsed = int((time.time() - started) * 1000)
            log(f"transcribed {len(audio_bytes)} bytes in {elapsed} ms", f"lang={info.language}")
            self._send_json({"text": text})
        except Exception as exc:  # noqa: BLE001
            log("ERROR", repr(exc))
            self._send_json({"error": str(exc)}, 500)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

    def do_DELETE(self):
        self._send_json({"status": "ok"})


def main():
    global MODEL, ARGS
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8085)
    parser.add_argument("--model", default=os.path.join(os.path.dirname(__file__), "model"))
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--beam", type=int, default=5)
    parser.add_argument("--compute-type", default="int8")
    ARGS = parser.parse_args()

    if not os.path.isdir(ARGS.model):
        log(f"model directory not found: {ARGS.model}")
        sys.exit(1)

    from faster_whisper import WhisperModel

    log(f"loading model from {ARGS.model} (compute_type={ARGS.compute_type})")
    started = time.time()
    MODEL = WhisperModel(
        ARGS.model,
        device="cpu",
        compute_type=ARGS.compute_type,
        cpu_threads=ARGS.threads,
    )
    log(f"model ready in {time.time() - started:.1f}s")

    server = ThreadingHTTPServer(("127.0.0.1", ARGS.port), Handler)
    log(f"listening on http://127.0.0.1:{ARGS.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
