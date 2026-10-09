#!/usr/bin/env node
const fs = require("fs");
const https = require("https");
const path = require("path");

const MODELS_DIR = path.join(__dirname, "..", "models");

const WHISPER_MODELS = {
  base: {
    fileName: "ggml-base.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    minBytes: 130_000_000,
  },
  small: {
    fileName: "ggml-small.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    minBytes: 450_000_000,
  },
  "large-v3-turbo": {
    fileName: "ggml-large-v3-turbo.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    minBytes: 1_620_000_000,
  },
  "large-v3": {
    fileName: "ggml-large-v3.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
    minBytes: 3_090_000_000,
  },
};

function downloadLargeFile(url, destPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Too many redirects"));
      return;
    }

    const existingBytes = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
    const headers = { "User-Agent": "OpenWhispr-Downloader" };
    if (existingBytes > 0) {
      headers.Range = `bytes=${existingBytes}-`;
      console.log(`[whisper-model] Resuming from ${Math.round(existingBytes / 1024 / 1024)} MB`);
    }

    const file = fs.createWriteStream(destPath, { flags: existingBytes > 0 ? "a" : "w" });

    const request = https.get(url, { headers }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        file.close();
        if (!location) {
          reject(new Error("Redirect without location header"));
          return;
        }
        const nextUrl = location.startsWith("/") ? new URL(location, url).href : location;
        downloadLargeFile(nextUrl, destPath, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode === 416 && existingBytes > 0) {
        file.close();
        resolve();
        return;
      }

      if (![200, 206].includes(response.statusCode)) {
        file.close();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const chunkTotal = parseInt(response.headers["content-length"], 10) || 0;
      let downloaded = existingBytes;

      response.on("data", (chunk) => {
        downloaded += chunk.length;
        const expectedTotal = response.statusCode === 206 ? existingBytes + chunkTotal : chunkTotal;
        if (expectedTotal > 0) {
          const pct = Math.round((downloaded / expectedTotal) * 100);
          process.stdout.write(`\r  Downloading: ${pct}%`);
        }
      });

      response.pipe(file);
      file.on("finish", () => {
        file.close();
        console.log(" Done");
        resolve();
      });
      file.on("error", reject);
      response.on("error", reject);
    });

    request.on("error", reject);
    request.setTimeout(0);
  });
}

async function main() {
  const modelKey = process.argv[2] || process.env.WHISPER_MODEL || "large-v3-turbo";
  const model = WHISPER_MODELS[modelKey];

  if (!model) {
    console.error(`Unknown model: ${modelKey}`);
    console.error(`Available: ${Object.keys(WHISPER_MODELS).join(", ")}`);
    process.exit(1);
  }

  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }

  const destPath = path.join(MODELS_DIR, model.fileName);

  if (fs.existsSync(destPath)) {
    const size = fs.statSync(destPath).size;
    if (size >= model.minBytes) {
      console.log(`[whisper-model] ${modelKey}: already exists at ${destPath}`);
      return;
    }
    console.log(`[whisper-model] Incomplete file (${Math.round(size / 1024 / 1024)} MB), resuming...`);
  } else {
    console.log(`[whisper-model] Downloading ${model.fileName} (${modelKey})...`);
  }

  await downloadLargeFile(model.url, destPath);

  const finalSize = fs.statSync(destPath).size;
  if (finalSize < model.minBytes) {
    throw new Error(`Downloaded file looks incomplete (${finalSize} bytes)`);
  }

  console.log(`[whisper-model] Saved to ${destPath}`);
  console.log(`[whisper-model] Update config.json:`);
  console.log(`  "whisperModelPath": "${destPath.replace(/\\/g, "/")}"`);
}

main().catch((error) => {
  console.error(`[whisper-model] Failed: ${error.message}`);
  process.exit(1);
});
