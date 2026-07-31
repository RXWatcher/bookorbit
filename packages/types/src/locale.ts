export const SUPPORTED_LOCALES = [
  "en",
  "cs",
  "da",
  "de",
  "es",
  "fi",
  "fr",
  "hu",
  "it",
  "ko",
  "nl",
  "pl",
  "pt",
  "ru",
  "sl",
  "sv",
  "uk",
  "zh",
] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Native display names for each supported locale, shown in the language picker. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  cs: "Čeština",
  da: "Dansk",
  de: "Deutsch",
  es: "Español",
  fi: "Suomi",
  fr: "Français",
  hu: "Magyar",
  it: "Italiano",
  ko: "한국어",
  nl: "Nederlands",
  pl: "Polski",
  pt: "Português",
  ru: "Русский",
  sl: "Slovenščina",
  sv: "Svenska",
  uk: "Українська",
  zh: "简体中文",
};

export const LOCALE_DIRECTIONS: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  cs: "ltr",
  da: "ltr",
  de: "ltr",
  es: "ltr",
  fi: "ltr",
  fr: "ltr",
  hu: "ltr",
  it: "ltr",
  ko: "ltr",
  nl: "ltr",
  pl: "ltr",
  pt: "ltr",
  ru: "ltr",
  sl: "ltr",
  sv: "ltr",
  uk: "ltr",
  zh: "ltr",
};

export interface LocalePreferences {
  locale: Locale;
}

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
