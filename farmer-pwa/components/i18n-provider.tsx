"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en from "@/locales/en.json";
import hi from "@/locales/hi.json";
import te from "@/locales/te.json";
import kn from "@/locales/kn.json";
import ta from "@/locales/ta.json";
import ml from "@/locales/ml.json";
import pwa from "@/locales/pwa.json";

export const languageOptions = [
  { code: "en", locale: "en-IN", label: "English" },
  { code: "hi", locale: "hi-IN", label: "हिन्दी" },
  { code: "te", locale: "te-IN", label: "తెలుగు" },
  { code: "kn", locale: "kn-IN", label: "ಕನ್ನಡ" },
  { code: "ta", locale: "ta-IN", label: "தமிழ்" },
  { code: "ml", locale: "ml-IN", label: "മലയാളം" },
] as const;

export type LanguageCode = (typeof languageOptions)[number]["code"];
type Dictionary = Record<string, string>;
type TranslationValues = Record<string, string | number>;
type I18nContextValue = {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
  t: (source: string, values?: TranslationValues) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDateTime: (value: string | Date, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (value: string | Date) => string;
};

const dictionaries: Record<LanguageCode, Dictionary> = { en, hi, te, kn, ta, ml };
const pwaEntries = pwa.entries as Record<string, string[]>;
const context = createContext<I18nContextValue | null>(null);
const STORAGE_KEY = "jalsaathi-language";

export function isLanguageCode(value: string | null): value is LanguageCode {
  return languageOptions.some((language) => language.code === value);
}

function browserLanguage(): LanguageCode {
  const browserCode = navigator.language.toLowerCase().split("-")[0];
  return isLanguageCode(browserCode) ? browserCode : "en";
}

export function I18nProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [language, setLanguageState] = useState<LanguageCode>("en");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.error("JalSaathi language preference could not be restored.", error);
    }
    setLanguageState(isLanguageCode(saved) ? saved : browserLanguage());
  }, []);

  useEffect(() => {
    document.documentElement.lang = languageOptions.find((item) => item.code === language)?.locale ?? "en";
  }, [language]);

  const setLanguage = useCallback((nextLanguage: LanguageCode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, nextLanguage);
    } catch (error) {
      console.error("JalSaathi language preference could not be saved.", error);
    }
    setLanguageState(nextLanguage);
  }, []);

  const t = useCallback((source: string, values?: TranslationValues) => {
    const languageIndex = languageOptions.findIndex((item) => item.code === language);
    const translated = dictionaries[language][source] ?? pwaEntries[source]?.[languageIndex] ?? source;
    if (!values) return translated;
    return translated.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, key: string) =>
      key in values ? String(values[key]) : placeholder,
    );
  }, [language]);

  const locale = languageOptions.find((item) => item.code === language)?.locale ?? "en-IN";
  const formatNumber = useCallback((value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(locale, options).format(value), [locale]);
  const formatDateTime = useCallback((value: string | Date, options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) =>
    new Intl.DateTimeFormat(locale, options).format(value instanceof Date ? value : new Date(value)), [locale]);
  const formatTime = useCallback((value: string | Date) => {
    if (value instanceof Date) return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(value);
    const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes));
  }, [locale]);

  const value = useMemo(() => ({ language, setLanguage, t, formatNumber, formatDateTime, formatTime }), [language, setLanguage, t, formatNumber, formatDateTime, formatTime]);
  return <context.Provider value={value}>{children}</context.Provider>;
}

export function useI18n() {
  const value = useContext(context);
  if (!value) throw new Error("useI18n must be used within I18nProvider.");
  return value;
}
