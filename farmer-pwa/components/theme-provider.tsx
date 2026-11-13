"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";

type ThemeContextValue = {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "jalsaathi-theme";

function getThemeChoice(value: string | null): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

export function isThemeChoice(value: string): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

function applyTheme(choice: ThemeChoice, darkMode: boolean) {
  const resolved = choice === "system" ? (darkMode ? "dark" : "light") : choice;
  document.documentElement.dataset.theme = resolved;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = resolved === "dark" ? "#121a16" : "#f5f7f3";
  });
}

export function ThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [choice, setChoiceState] = useState<ThemeChoice>("system");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let storedChoice: string | null = null;
    try {
      storedChoice = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.error("JalSaathi theme preference could not be restored.", error);
    }
    const savedChoice = getThemeChoice(storedChoice);
    setChoiceState(savedChoice);
    applyTheme(savedChoice, media.matches);
    const onSystemThemeChange = (event: MediaQueryListEvent) => {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(STORAGE_KEY);
      } catch (error) {
        console.error("JalSaathi theme preference could not be read.", error);
      }
      if (getThemeChoice(stored) === "system") {
        applyTheme("system", event.matches);
      }
    };
    media.addEventListener("change", onSystemThemeChange);
    return () => media.removeEventListener("change", onSystemThemeChange);
  }, []);

  const setChoice = useCallback((nextChoice: ThemeChoice) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, nextChoice);
    } catch (error) {
      console.error("JalSaathi theme preference could not be saved.", error);
    }
    setChoiceState(nextChoice);
    applyTheme(nextChoice, window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);

  const value = useMemo(() => ({ choice, setChoice }), [choice, setChoice]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider.");
  return context;
}
