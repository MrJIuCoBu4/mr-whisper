const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const DEFAULT_CONFIG = {
  whisperModelPath: "",
  formattingModelPath: "",
  formattingEnabled: true,
  resultWindow: true,
  // Recognition quality: VAD trims silence, beam search trades decoder time for
  // accuracy, and non-speech token suppression keeps noise from inventing words.
  whisperVad: true,
  whisperBeamSize: 5,
  suppressNonSpeech: true,
  whisperPrompt: "Диктовка на русском языке с пунктуацией и заглавными буквами.",
  // Empty = use the bundled whisper.cpp server. Set to e.g. "http://127.0.0.1:8085"
  // to use an external engine (tools/fw-server) that speaks the same protocol.
  whisperServerUrl: "",
  language: "ru",
  hotkey: "Alt+Z",
  activationMode: "push-to-talk",
  microphoneDeviceId: "",
  preferBuiltInMic: true,
};

function getExeDir() {
  if (process.env.NODE_ENV === "development") {
    return path.join(__dirname, "..", "..");
  }
  return path.dirname(process.execPath);
}

function getConfigPaths() {
  const paths = [
    path.join(getExeDir(), "config.json"),
    path.join(app.getPath("userData"), "config.json"),
  ];
  return [...new Set(paths)];
}

function validateModelPath(modelPath) {
  if (!modelPath || typeof modelPath !== "string") {
    return { valid: false, error: "whisperModelPath is required" };
  }

  const normalized = path.normalize(modelPath.trim());
  if (normalized.includes("..")) {
    return { valid: false, error: "Invalid model path" };
  }

  if (!normalized.toLowerCase().endsWith(".bin")) {
    return { valid: false, error: "Model file must be a .bin file" };
  }

  if (!fs.existsSync(normalized)) {
    return { valid: false, error: `Model file not found: ${normalized}` };
  }

  return { valid: true, path: normalized };
}

class ConfigManager {
  constructor() {
    this.configPath = null;
    this.config = { ...DEFAULT_CONFIG };
  }

  syncEnvFromConfig() {
    if (this.config.hotkey) {
      process.env.DICTATION_KEY = this.config.hotkey;
    }
    const mode = this.config.activationMode === "tap-to-talk" ? "tap" : "push";
    process.env.ACTIVATION_MODE = mode;
  }

  load() {
    for (const candidate of getConfigPaths()) {
      try {
        if (fs.existsSync(candidate)) {
          const raw = JSON.parse(fs.readFileSync(candidate, "utf8"));
          this.config = { ...DEFAULT_CONFIG, ...raw };
          this.configPath = candidate;
          this.syncEnvFromConfig();
          return this.config;
        }
      } catch {
        // try next path
      }
    }

    this.configPath = path.join(app.getPath("userData"), "config.json");
    this.config = { ...DEFAULT_CONFIG };
    this.save();
    return this.config;
  }

  get() {
    return { ...this.config };
  }

  save(updates = {}) {
    this.config = { ...this.config, ...updates };
    const dir = path.dirname(this.configPath || path.join(app.getPath("userData"), "config.json"));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const target = this.configPath || path.join(dir, "config.json");
    fs.writeFileSync(target, JSON.stringify(this.config, null, 2), "utf8");
    this.configPath = target;

    this.syncEnvFromConfig();

    return this.config;
  }

  getModelPath() {
    const validation = validateModelPath(this.config.whisperModelPath);
    return validation.valid ? validation.path : null;
  }

  getModelValidation() {
    return validateModelPath(this.config.whisperModelPath);
  }

  getFormattingModelPath() {
    const validation = validateFormattingModelPath(this.config.formattingModelPath);
    return validation.valid ? validation.path : null;
  }

  getFormattingModelValidation() {
    return validateFormattingModelPath(this.config.formattingModelPath);
  }

  getActivationMode() {
    return this.config.activationMode === "tap-to-talk" ? "tap" : "push";
  }
}

function validateFormattingModelPath(modelPath) {
  if (!modelPath || typeof modelPath !== "string") {
    return { valid: false, error: "formattingModelPath is required for text formatting" };
  }

  const normalized = path.normalize(modelPath.trim());
  if (normalized.includes("..")) {
    return { valid: false, error: "Invalid formatting model path" };
  }

  if (!normalized.toLowerCase().endsWith(".gguf")) {
    return { valid: false, error: "Formatting model must be a .gguf file" };
  }

  if (!fs.existsSync(normalized)) {
    return { valid: false, error: `Formatting model not found: ${normalized}` };
  }

  return { valid: true, path: normalized };
}

module.exports = {
  ConfigManager,
  DEFAULT_CONFIG,
  validateModelPath,
  validateFormattingModelPath,
  getConfigPaths,
};
