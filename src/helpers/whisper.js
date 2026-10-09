const fs = require("fs");
const path = require("path");
const debugLogger = require("./debugLogger");
const WhisperServerManager = require("./whisperServer");

function requireConfiguredModelPath(modelPath) {
  if (!modelPath || typeof modelPath !== "string") {
    throw new Error("whisperModelPath must be set in config.json");
  }
  const normalized = path.normalize(modelPath.trim());
  if (normalized.includes("..")) {
    throw new Error("Invalid model path");
  }
  if (!fs.existsSync(normalized)) {
    throw new Error(`Whisper model not found: ${normalized}`);
  }
  return normalized;
}

class WhisperManager {
  constructor() {
    this.serverManager = new WhisperServerManager();
    this.currentServerModel = null;
    this.cachedVadModelPath = undefined;
  }

  getVadModelPath() {
    if (this.cachedVadModelPath !== undefined) return this.cachedVadModelPath;

    const fileName = "ggml-silero-v5.1.2.bin";
    const candidates = [];

    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, "bin", "whisper-vad", fileName));
    }
    candidates.push(path.join(__dirname, "..", "..", "resources", "bin", "whisper-vad", fileName));

    const resolved = candidates.find((p) => fs.existsSync(p)) || null;
    this.cachedVadModelPath = resolved;
    return resolved;
  }

  async checkWhisperInstallation() {
    const serverPath = this.serverManager.getServerBinaryPath();
    if (!serverPath) {
      return { installed: false, working: false };
    }

    return {
      installed: true,
      working: this.serverManager.isAvailable(),
      path: serverPath,
    };
  }

  resolveModelPath(options = {}) {
    return requireConfiguredModelPath(options.modelPath);
  }

  // Single source of truth for the recognition-quality flags, shared by the pre-warm
  // and the per-request path so the server is not restarted between them.
  qualityOptions(config = {}) {
    const vadEnabled = config.whisperVad !== false;
    return {
      useCuda: false,
      vadEnabled,
      vadModelPath: vadEnabled ? this.getVadModelPath() : null,
      beamSize: config.whisperBeamSize ?? 5,
      suppressNonSpeech: config.suppressNonSpeech !== false,
    };
  }

  async initializeFromConfig(config = {}) {
    // An external server (tools/fw-server) runs its own model — nothing to spawn here.
    // Only skip the local pre-warm when it actually answered: on failure fall through
    // and warm up whisper.cpp, otherwise the first dictation pays the model load.
    if (config.whisperServerUrl) {
      try {
        await this.serverManager.connectRemote(config.whisperServerUrl);
        debugLogger.info("whisper-server: using external server", { url: config.whisperServerUrl });
        return;
      } catch (err) {
        debugLogger.warn("External whisper-server unreachable, falling back to local", {
          url: config.whisperServerUrl,
          error: err.message,
        });
      }
    }

    const modelPath = config.whisperModelPath
      ? this.resolveModelPath({ modelPath: config.whisperModelPath })
      : null;
    if (!modelPath || !this.serverManager.isAvailable()) {
      return;
    }

    try {
      // Pre-warm with the same quality options the per-request path uses — `start()`
      // returns early when the model and VAD signature match, so whatever the pre-warm
      // launches with is what every following request runs on.
      await this.serverManager.start(modelPath, this.qualityOptions(config));
      this.currentServerModel = modelPath;
      debugLogger.info("whisper-server pre-warmed from config", {
        modelPath,
        port: this.serverManager.port,
      });
    } catch (err) {
      debugLogger.warn("Config pre-warm failed (will start on first use)", { error: err.message });
    }
  }

  async transcribeLocalWhisper(audioBlob, options = {}) {
    debugLogger.logWhisperPipeline("transcribeLocalWhisper - start", {
      options: { ...options, modelPath: options.modelPath ? "[set]" : undefined },
      audioBlobType: audioBlob?.constructor?.name,
      audioBlobSize: audioBlob?.byteLength || audioBlob?.size || 0,
      serverAvailable: this.serverManager.isAvailable(),
      serverReady: this.serverManager.ready,
    });

    // An external engine brings its own binary and model — neither is required locally.
    const remote = this.serverManager.isRemote;

    if (!remote && !this.serverManager.isAvailable()) {
      throw new Error(
        "whisper-server binary not found. Please ensure the app is installed correctly."
      );
    }

    const language = options.language || null;
    const initialPrompt = options.initialPrompt || null;
    const vadEnabled = options.vadEnabled === true;
    const vadConfig = options.vadConfig || null;
    const modelPath = remote ? null : this.resolveModelPath(options);

    return await this.transcribeViaServer(audioBlob, modelPath, language, initialPrompt, {
      vadEnabled,
      vadConfig,
      beamSize: options.beamSize,
      suppressNonSpeech: options.suppressNonSpeech,
      modelPath,
    });
  }

  async transcribeViaServer(audioBlob, model, language, initialPrompt = null, options = {}) {
    debugLogger.info("Transcription mode: SERVER", { model, language: language || "auto" });
    const modelPath = this.serverManager.isRemote
      ? null
      : this.resolveModelPath({ modelPath: options.modelPath });

    const vadEnabled = options.vadEnabled === true;
    const vadModelPath = vadEnabled ? this.getVadModelPath() : null;
    if (vadEnabled && !vadModelPath) {
      debugLogger.warn("VAD requested but ggml-silero model not found; running without VAD");
    }

    // Already talking to an external server — do not spawn or restart a local one.
    if (!this.serverManager.isRemote) {
      await this.serverManager.start(modelPath, {
        useCuda: this.serverManager.useCuda,
        vadEnabled,
        vadModelPath,
        vadConfig: options.vadConfig || null,
        beamSize: options.beamSize,
        suppressNonSpeech: options.suppressNonSpeech,
      });
    }
    this.currentServerModel = model;

    let audioBuffer;
    if (Buffer.isBuffer(audioBlob)) {
      audioBuffer = audioBlob;
    } else if (ArrayBuffer.isView(audioBlob)) {
      audioBuffer = Buffer.from(audioBlob.buffer, audioBlob.byteOffset, audioBlob.byteLength);
    } else if (audioBlob instanceof ArrayBuffer) {
      audioBuffer = Buffer.from(audioBlob);
    } else if (typeof audioBlob === "string") {
      audioBuffer = Buffer.from(audioBlob, "base64");
    } else if (audioBlob && audioBlob.buffer && typeof audioBlob.byteLength === "number") {
      audioBuffer = Buffer.from(audioBlob.buffer, audioBlob.byteOffset || 0, audioBlob.byteLength);
    } else {
      throw new Error(`Unsupported audio data type: ${typeof audioBlob}`);
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error("Audio buffer is empty - no audio data received");
    }

    debugLogger.logWhisperPipeline("transcribeViaServer - sending to server", {
      bufferSize: audioBuffer.length,
      model,
      language,
      port: this.serverManager.port,
    });

    const startTime = Date.now();
    const result = await this.serverManager.transcribe(audioBuffer, { language, initialPrompt });
    const elapsed = Date.now() - startTime;

    debugLogger.logWhisperPipeline("transcribeViaServer - completed", {
      elapsed,
      resultKeys: Object.keys(result),
    });

    return this.parseWhisperResult(result);
  }

  normalizeWhitespace(text) {
    return text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  }

  parseWhisperResult(output) {
    let result;
    if (typeof output === "string") {
      debugLogger.logWhisperPipeline("Parsing result (string)", { length: output.length });
      try {
        result = JSON.parse(output);
      } catch (parseError) {
        const text = this.normalizeWhitespace(output);
        if (text && !this.isBlankAudioMarker(text)) {
          return { success: true, text };
        }
        throw new Error(`Failed to parse Whisper output: ${parseError.message}`);
      }
    } else if (typeof output === "object" && output !== null) {
      debugLogger.logWhisperPipeline("Parsing result (object)", { keys: Object.keys(output) });
      result = output;
    } else {
      throw new Error(`Unexpected Whisper output type: ${typeof output}`);
    }

    if (result.transcription && Array.isArray(result.transcription)) {
      const text = this.normalizeWhitespace(result.transcription.map((seg) => seg.text).join(""));
      if (!text || this.isBlankAudioMarker(text)) {
        return { success: false, message: "No audio detected" };
      }
      return { success: true, text };
    }

    if (result.text !== undefined) {
      const text = typeof result.text === "string" ? this.normalizeWhitespace(result.text) : "";
      if (!text || this.isBlankAudioMarker(text)) {
        return { success: false, message: "No audio detected" };
      }
      return { success: true, text };
    }

    return { success: false, message: "No audio detected" };
  }

  isBlankAudioMarker(text) {
    const normalized = text.trim().toLowerCase();
    return normalized === "[blank_audio]" || normalized === "[ blank_audio ]";
  }
}

module.exports = WhisperManager;
