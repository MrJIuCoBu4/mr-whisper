#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");

// Mock electron for standalone test runs
const electronPath = require.resolve("electron");
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    app: {
      isReady: () => true,
      getPath: (name) => {
        if (name === "userData") return path.join(os.tmpdir(), "openwhispr-test");
        if (name === "home") return os.homedir();
        return os.tmpdir();
      },
    },
  },
};

const FormattingManager = require("../src/helpers/formattingManager");

const PROJECT_ROOT = path.join(__dirname, "..");
const DEFAULT_MODEL_PATH = path.join(PROJECT_ROOT, "models", "qwen2.5-1.5b-instruct-q5_k_m.gguf");

const SAMPLE =
  process.argv.slice(2).join(" ") ||
  "ну эм привет это тестовая диктовка надо проверить что форматирование работает";

async function main() {
  if (!fs.existsSync(DEFAULT_MODEL_PATH)) {
    console.error(`Model not found: ${DEFAULT_MODEL_PATH}`);
    console.error("Run: npm run download:formatting-model");
    process.exit(1);
  }

  const manager = new FormattingManager();
  if (!manager.isServerAvailable()) {
    console.error("llama-server binary not found. Run: npm run download:llama-server");
    process.exit(1);
  }

  console.log("Input:", SAMPLE);
  const started = Date.now();
  const result = await manager.formatText(SAMPLE, {
    formattingEnabled: true,
    formattingModelPath: DEFAULT_MODEL_PATH,
    language: "ru",
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.success) {
    console.error("Formatting failed:", result.error);
    process.exit(1);
  }

  console.log(`Output (${elapsed}s):`, result.text);
  await manager.serverManager.stop();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
