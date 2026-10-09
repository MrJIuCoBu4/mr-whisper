#!/usr/bin/env node
const fs = require("fs");
const https = require("https");
const path = require("path");

const MODELS_DIR = path.join(__dirname, "..", "models");

const DEFAULT_MODEL = {
  fileName: "qwen2.5-1.5b-instruct-q5_k_m.gguf",
  url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q5_k_m.gguf",
  minBytes: 1_000_000_000,
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
      console.log(`[formatting-model] Resuming from ${Math.round(existingBytes / 1024 / 1024)} MB`);
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

      if (![200, 206].includes(response.statusCode)) {
        file.close();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const total = parseInt(response.headers["content-length"], 10) || 0;
      let downloaded = existingBytes;

      response.on("data", (chunk) => {
        downloaded += chunk.length;
        if (total > 0 || response.statusCode === 206) {
          const expectedTotal =
            response.statusCode === 206
              ? existingBytes + total
              : parseInt(response.headers["content-length"], 10) + existingBytes;
          const pct = expectedTotal ? Math.round((downloaded / expectedTotal) * 100) : 0;
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
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }

  const destPath = path.join(MODELS_DIR, DEFAULT_MODEL.fileName);

  if (fs.existsSync(destPath)) {
    const size = fs.statSync(destPath).size;
    if (size >= DEFAULT_MODEL.minBytes) {
      console.log(`[formatting-model] Already exists at ${destPath}`);
      return;
    }
    console.log(`[formatting-model] Incomplete file (${Math.round(size / 1024 / 1024)} MB), resuming...`);
  } else {
    console.log(`[formatting-model] Downloading ${DEFAULT_MODEL.fileName} (~1.3 GB)...`);
    console.log(`[formatting-model] URL: ${DEFAULT_MODEL.url}`);
  }

  await downloadLargeFile(DEFAULT_MODEL.url, destPath);

  const finalSize = fs.statSync(destPath).size;
  if (finalSize < DEFAULT_MODEL.minBytes) {
    throw new Error(`Downloaded file looks incomplete (${finalSize} bytes)`);
  }

  console.log(`[formatting-model] Saved to ${destPath}`);
}

main().catch((error) => {
  console.error(`[formatting-model] Failed: ${error.message}`);
  process.exit(1);
});
