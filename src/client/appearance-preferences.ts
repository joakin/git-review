import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import { googleFontStylesheet } from "./code-fonts.ts";
import { appearanceStorageKey, codeTypographyStorageKey, defaultAppearance, defaultCodeTypography, readAppearance, readCodeTypography, resolveAppearance, saveAppearance, saveCodeTypography, validateAppearance, validateCodeTypography, type Appearance, type CodeTypography } from "./storage.ts";

type AppearancePreferences = {
  appearance: Appearance;
  typography: CodeTypography;
  changeAppearance: (next: Appearance) => void;
  changeTypography: (next: CodeTypography) => void;
  resetAppearance: () => void;
  resetTypography: () => void;
};

export function useAppearancePreferences(): AppearancePreferences {
  const [appearance, setAppearance] = useState(readAppearance);
  const [typography, setTypography] = useState(readCodeTypography);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === codeTypographyStorageKey || event.key === null) setTypography(readCodeTypography());
      if (event.key === appearanceStorageKey || event.key === null) setAppearance(readAppearance());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const { appTheme, codeTheme } = resolveAppearance(appearance, systemDark);
  useLayoutEffect(() => {
    document.documentElement.dataset["appTheme"] = appTheme;
    document.documentElement.dataset["codeTheme"] = codeTheme;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor !== null) themeColor.content = appTheme === "dark" ? "#08151d" : "#101823";
  }, [appTheme, codeTheme]);

  useEffect(() => {
    const stylesheet = googleFontStylesheet(typography.fontFamily);
    if (stylesheet === null) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = stylesheet;
    document.head.append(link);
    return () => link.remove();
  }, [typography.fontFamily]);

  function changeAppearance(next: Appearance): void {
    const validated = validateAppearance(next);
    if (validated === null) return;
    setAppearance(validated);
    saveAppearance(validated);
  }

  function changeTypography(next: CodeTypography): void {
    const validated = validateCodeTypography(next);
    if (validated === null) return;
    setTypography(validated);
    saveCodeTypography(validated);
  }

  return {
    appearance,
    typography,
    changeAppearance,
    changeTypography,
    resetAppearance: () => changeAppearance(defaultAppearance),
    resetTypography: () => changeTypography(defaultCodeTypography),
  };
}
