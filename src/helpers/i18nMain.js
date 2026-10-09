const i18next = require("i18next");

const enTranslation = require("../locales/en/translation.json");
const ruTranslation = require("../locales/ru/translation.json");
const enPrompts = require("../locales/en/prompts.json");
const ruPrompts = require("../locales/ru/prompts.json");

const SUPPORTED_UI_LANGUAGES = ["en", "ru"];

function normalizeUiLanguage(language) {
  const candidate = (language || "").trim().toLowerCase();
  if (candidate.startsWith("ru")) return "ru";
  if (candidate.startsWith("en")) return "en";
  return "ru";
}

const i18nMain = i18next.createInstance();

void i18nMain.init({
  initAsync: false,
  resources: {
    en: {
      translation: enTranslation,
      prompts: enPrompts,
    },
    ru: {
      translation: ruTranslation,
      prompts: ruPrompts,
    },
  },
  lng: normalizeUiLanguage(process.env.UI_LANGUAGE || "ru"),
  fallbackLng: "en",
  ns: ["translation", "prompts"],
  defaultNS: "translation",
  interpolation: {
    escapeValue: false,
  },
  returnEmptyString: false,
  returnNull: false,
});

function changeLanguage(language) {
  const normalized = normalizeUiLanguage(language);

  if (i18nMain.language !== normalized) {
    void i18nMain.changeLanguage(normalized);
  }

  return normalized;
}

module.exports = {
  i18nMain,
  changeLanguage,
  normalizeUiLanguage,
  SUPPORTED_UI_LANGUAGES,
};
