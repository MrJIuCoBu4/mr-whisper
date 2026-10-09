import enTranslation from "./en/translation.json";
import ruTranslation from "./ru/translation.json";

export const TRANSLATIONS_BY_LOCALE = {
  en: enTranslation,
  ru: ruTranslation,
} as const;
