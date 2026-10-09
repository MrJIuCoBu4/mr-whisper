import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { PROMPTS_BY_LOCALE } from "./locales/prompts";
import { TRANSLATIONS_BY_LOCALE } from "./locales/translations";

export const SUPPORTED_UI_LANGUAGES = ["en", "ru"] as const;
export type UiLanguage = (typeof SUPPORTED_UI_LANGUAGES)[number];

export function normalizeUiLanguage(language: string | null | undefined): UiLanguage {
  const candidate = (language || "").trim().toLowerCase();
  if (candidate.startsWith("ru")) return "ru";
  if (candidate.startsWith("en")) return "en";
  return "ru";
}

const resources = {
  en: {
    translation: TRANSLATIONS_BY_LOCALE.en,
    prompts: PROMPTS_BY_LOCALE.en,
  },
  ru: {
    translation: TRANSLATIONS_BY_LOCALE.ru,
    prompts: PROMPTS_BY_LOCALE.ru,
  },
} as const;

const storageLanguage =
  typeof window !== "undefined" ? window.localStorage.getItem("uiLanguage") : undefined;

const initialLanguage = normalizeUiLanguage(storageLanguage || "ru");

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: "en",
  ns: ["translation", "prompts"],
  defaultNS: "translation",
  interpolation: {
    escapeValue: false,
  },
  returnEmptyString: true,
  returnNull: false,
});

export default i18n;
