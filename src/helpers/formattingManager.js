const fs = require("fs");
const os = require("os");
const path = require("path");
const LlamaServerManager = require("./llamaServer");
const debugLogger = require("./debugLogger");

// Same reasoning as for whisper: leave half the cores free for the rest of the system,
// but 4 threads made prompt evaluation alone take ~16 s per phrase.
function formattingThreads() {
  const logical = os.cpus()?.length || 4;
  return Math.max(2, Math.min(8, Math.floor(logical / 2)));
}

const REFUSAL_PATTERNS = [
  /не могу использовать/i,
  /извините за путаницу/i,
  /я здесь.*чтобы помочь/i,
  /если у вас есть/i,
  /пожалуйста.*дайте знать/i,
  /я не могу/i,
  /sorry for the confusion/i,
  /i(?:'m| am) here to help/i,
  /cannot use your text/i,
];

const RU_CLEANUP_PROMPT = `Ты — редактор транскрипции голосовой диктовки.

Задача: преобразовать сырой текст распознавания речи в чистый письменный текст.

Разрешено:

* исправлять орфографические ошибки
* исправлять пунктуацию
* исправлять очевидные ошибки распознавания речи по контексту
* удалять слова-паразиты: эм, ээ, ну, типа, как бы, в общем, короче
* удалять случайные повторы слов и фраз
* разбивать текст на абзацы при необходимости

Обязательно:

* сохранять исходный смысл
* сохранять язык оригинала
* сохранять стиль речи автора
* сохранять все факты, числа, даты, имена и названия

Запрещено:

* отвечать как ассистент
* добавлять новую информацию
* дописывать мысли автора
* сокращать содержание
* пересказывать текст своими словами
* переводить текст
* комментировать результат
* задавать вопросы
* объяснять внесённые изменения

Если фраза неоднозначна:

* оставляй максимально близкий к оригиналу вариант
* не придумывай отсутствующие слова

Формат ответа:
верни только исправленный текст без комментариев, пояснений, префиксов и кавычек.

Дополнительно:

* если последовательность слов выглядит как очевидная ошибка распознавания речи, восстанови наиболее вероятную фразу по контексту
* допускается замена нескольких подряд идущих слов, если это необходимо для восстановления исходного смысла
* предпочтение отдавай общеупотребительным русским словам и устойчивым выражениям
* если уверенность низкая, оставляй текст максимально близким к оригиналу

Пример:

Вход:
"при образовании сервелой текст распознавания вечеричной письменей тексту"

Выход:
"при преобразовании сырого текста распознавания речи в чистый письменный текст"`;

function resolveLanguage(config = {}) {
  const lang = (config.language || "ru").trim().toLowerCase();
  return lang === "auto" ? "ru" : lang;
}

function getCleanupSystemPrompt(config = {}) {
  const language = resolveLanguage(config);
  if (language === "ru" || language.startsWith("ru")) {
    return RU_CLEANUP_PROMPT;
  }
  return `You clean up dictated speech. Output only the corrected text in ${language}. Never reply as a chat assistant.`;
}

function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function wordOverlapRatio(source, candidate) {
  const sourceWords = new Set(normalizeWords(source));
  const candidateWords = normalizeWords(candidate);
  if (candidateWords.length === 0) return 1;
  let overlap = 0;
  for (const word of candidateWords) {
    if (sourceWords.has(word)) overlap += 1;
  }
  return overlap / candidateWords.length;
}

function looksLikeAssistantRefusal(output, input) {
  if (REFUSAL_PATTERNS.some((pattern) => pattern.test(output))) {
    return true;
  }

  const overlap = wordOverlapRatio(input, output);
  if (input.length < 300 && overlap < 0.2) {
    return true;
  }
  if (output.length > input.length * 2 && overlap < 0.35) {
    return true;
  }

  return false;
}

function buildUserPrompt(text) {
  return `Исправь текст диктовки ниже. Верни только исправленный текст.

<<<DICTATION>>>
${text}
<<<END>>>`;
}

class FormattingManager {
  constructor() {
    this.serverManager = new LlamaServerManager();
    this.currentModelPath = null;
  }

  isServerAvailable() {
    return this.serverManager.isAvailable();
  }

  async initializeFromConfig(config) {
    if (!config?.formattingEnabled) return;
    const modelPath = this.resolveModelPath(config);
    if (!modelPath || !this.isServerAvailable()) return;

    try {
      await this.serverManager.start(modelPath, { threads: formattingThreads(), contextSize: 4096 });
      this.currentModelPath = modelPath;
      debugLogger.info("llama-server pre-warmed for formatting", {
        modelPath,
        port: this.serverManager.port,
      });
    } catch (err) {
      debugLogger.warn("Formatting pre-warm failed (will start on first use)", {
        error: err.message,
      });
    }
  }

  resolveModelPath(config = {}) {
    const modelPath = config.formattingModelPath;
    if (!modelPath || typeof modelPath !== "string") return null;
    const normalized = path.normalize(modelPath.trim());
    if (normalized.includes("..")) return null;
    if (!normalized.toLowerCase().endsWith(".gguf")) return null;
    if (!fs.existsSync(normalized)) return null;
    return normalized;
  }

  calculateMaxTokens(textLength) {
    return Math.max(64, Math.min(Math.ceil(textLength * 1.5) + 32, 512));
  }

  stripThinkingArtifacts(text) {
    return text
      .replace(/[\s\S]*?<\/think>/gi, "")
      .replace(/^<<<DICTATION>>>[\s\S]*?<<<END>>>\s*/i, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
  }

  async formatText(text, config = {}) {
    const trimmed = text?.trim();
    if (!trimmed) {
      return { success: false, error: "No text to format" };
    }

    if (!config.formattingEnabled) {
      return { success: true, text: trimmed, skipped: true };
    }

    const modelPath = this.resolveModelPath(config);
    if (!modelPath) {
      return { success: false, error: "Formatting model path not configured or missing" };
    }

    if (!this.isServerAvailable()) {
      return {
        success: false,
        error: "llama-server binary not found. Run: npm run download:llama-server",
      };
    }

    try {
      if (!this.serverManager.ready || this.currentModelPath !== modelPath) {
        await this.serverManager.start(modelPath, { threads: formattingThreads(), contextSize: 4096 });
        this.currentModelPath = modelPath;
      }

      const messages = [
        { role: "system", content: getCleanupSystemPrompt(config) },
        { role: "user", content: buildUserPrompt(trimmed) },
      ];

      const result = await this.serverManager.inference(messages, {
        temperature: 0.05,
        max_tokens: this.calculateMaxTokens(trimmed.length),
        disableThinking: true,
      });

      const cleaned = this.stripThinkingArtifacts(result);
      if (!cleaned || looksLikeAssistantRefusal(cleaned, trimmed)) {
        debugLogger.warn("Formatting rejected assistant-style output, using raw text", {
          preview: cleaned?.substring(0, 120),
        });
        return { success: true, text: trimmed, rawText: trimmed, fallback: true, rejected: true };
      }

      return { success: true, text: cleaned, rawText: trimmed };
    } catch (error) {
      debugLogger.error("formatText failed", { error: error.message });
      return { success: false, error: error.message };
    }
  }
}

module.exports = FormattingManager;
