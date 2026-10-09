import enPrompts from "./en/prompts.json";
import ruPrompts from "./ru/prompts.json";

export const PROMPTS_BY_LOCALE = {
  en: enPrompts,
  ru: ruPrompts,
} as const;
