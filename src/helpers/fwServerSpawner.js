const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");
const { app } = require("electron");
const debugLogger = require("./debugLogger");
const { killProcess } = require("../utils/process");

/**
 * Starts the optional CTranslate2 engine (tools/fw-server) when the config points at it.
 *
 * The app talks to it over the same HTTP protocol as whisper.cpp, so all this has to do
 * is make sure the process is up before the whisper pre-warm tries to connect. If
 * anything is missing the app simply falls back to the bundled whisper.cpp server.
 */

const READY_TIMEOUT_MS = 60000;
const READY_POLL_MS = 1000;
const PROBE_TIMEOUT_MS = 1500;

let fwProcess = null;

function isLoopback(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function probe(hostname, port) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname, port, path: "/", method: "GET", timeout: PROBE_TIMEOUT_MS },
      (res) => {
        res.resume();
        resolve(true);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function servicePaths() {
  const dir = path.join(app.getAppPath(), "tools", "fw-server");
  const python = path.join(
    dir,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python"
  );

  return {
    dir,
    python,
    script: path.join(dir, "server.py"),
    model: path.join(dir, "model", "model.bin"),
  };
}

async function waitUntilReady(hostname, port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probe(hostname, port)) return true;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  return false;
}

async function ensureFwServer(config = {}) {
  const url = config.whisperServerUrl;
  if (!url) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    debugLogger.warn("External whisper-server URL is not valid", { url });
    return false;
  }

  // A remote host is somebody else's problem — nothing to start here.
  if (!isLoopback(parsed.hostname)) return true;

  const port = parseInt(parsed.port, 10) || 80;

  if (await probe(parsed.hostname, port)) {
    debugLogger.info("External whisper-server already running", { port });
    return true;
  }

  const paths = servicePaths();
  const missing = [paths.python, paths.script, paths.model].filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    debugLogger.warn("External engine is not installed, falling back to whisper.cpp", {
      missing,
    });
    return false;
  }

  const threads = Math.max(2, Math.min(8, Math.floor((os.cpus()?.length || 4) / 2)));
  const beamSize = config.whisperBeamSize ?? 5;

  debugLogger.info("Starting external whisper-server", { port, threads, beamSize });

  fwProcess = spawn(
    paths.python,
    [paths.script, "--port", String(port), "--threads", String(threads), "--beam", String(beamSize)],
    { cwd: paths.dir, windowsHide: true }
  );

  fwProcess.stdout.on("data", (data) => debugLogger.info("fw-server", { data: String(data).trim() }));
  fwProcess.stderr.on("data", (data) =>
    debugLogger.warn("fw-server stderr", { data: String(data).trim() })
  );
  fwProcess.on("exit", (code) => {
    debugLogger.warn("External whisper-server exited", { code });
    fwProcess = null;
  });
  fwProcess.on("error", (err) => {
    debugLogger.warn("External whisper-server failed to start", { error: err.message });
    fwProcess = null;
  });

  const ready = await waitUntilReady(parsed.hostname, port);
  if (!ready) {
    debugLogger.warn("External whisper-server did not become ready, falling back to whisper.cpp", {
      port,
    });
    stopFwServer();
    return false;
  }

  debugLogger.info("External whisper-server ready", { port });
  return true;
}

function stopFwServer() {
  if (!fwProcess) return;
  try {
    killProcess(fwProcess);
  } catch (err) {
    debugLogger.warn("Failed to stop external whisper-server", { error: err.message });
  }
  fwProcess = null;
}

module.exports = { ensureFwServer, stopFwServer };
