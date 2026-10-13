import { readAppearance, resolveAppearance } from "./storage.ts";

const { appTheme, codeTheme } = resolveAppearance(
  readAppearance(),
  window.matchMedia("(prefers-color-scheme: dark)").matches,
);
document.documentElement.dataset["appTheme"] = appTheme;
document.documentElement.dataset["codeTheme"] = codeTheme;
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
if (themeColor !== null) themeColor.content = appTheme === "dark" ? "#08151d" : "#101823";
