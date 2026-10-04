export const googleCodeFonts = [
  {
    id: "roboto-mono",
    label: "Roboto Mono",
    stylesheet: "https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap",
  },
  {
    id: "ibm-plex-mono",
    label: "IBM Plex Mono",
    stylesheet: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&display=swap",
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    stylesheet: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap",
  },
  {
    id: "inconsolata",
    label: "Inconsolata",
    stylesheet: "https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;700&display=swap",
  },
  {
    id: "source-code-pro",
    label: "Source Code Pro",
    stylesheet:
      "https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;700&display=swap",
  },
  {
    id: "fira-code",
    label: "Fira Code",
    stylesheet: "https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap",
  },
  {
    id: "martian-mono",
    label: "Martian Mono",
    stylesheet: "https://fonts.googleapis.com/css2?family=Martian+Mono:wght@400;700&display=swap",
  },
  {
    id: "geist-mono",
    label: "Geist Mono",
    stylesheet: "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;700&display=swap",
  },
  {
    id: "space-mono",
    label: "Space Mono",
    stylesheet: "https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap",
  },
  {
    id: "courier-prime",
    label: "Courier Prime",
    stylesheet: "https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap",
  },
  {
    id: "ubuntu-sans-mono",
    label: "Ubuntu Sans Mono",
    stylesheet:
      "https://fonts.googleapis.com/css2?family=Ubuntu+Sans+Mono:wght@400;700&display=swap",
  },
  {
    id: "google-sans-code",
    label: "Google Sans Code",
    stylesheet:
      "https://fonts.googleapis.com/css2?family=Google+Sans+Code:wght@400;700&display=swap",
  },
  {
    id: "anonymous-pro",
    label: "Anonymous Pro",
    stylesheet: "https://fonts.googleapis.com/css2?family=Anonymous+Pro:wght@400;700&display=swap",
  },
  {
    id: "azeret-mono",
    label: "Azeret Mono",
    stylesheet: "https://fonts.googleapis.com/css2?family=Azeret+Mono:wght@400;700&display=swap",
  },
  {
    id: "overpass-mono",
    label: "Overpass Mono",
    stylesheet: "https://fonts.googleapis.com/css2?family=Overpass+Mono:wght@400;700&display=swap",
  },
  {
    id: "red-hat-mono",
    label: "Red Hat Mono",
    stylesheet: "https://fonts.googleapis.com/css2?family=Red+Hat+Mono:wght@400;700&display=swap",
  },
  {
    id: "spline-sans-mono",
    label: "Spline Sans Mono",
    stylesheet:
      "https://fonts.googleapis.com/css2?family=Spline+Sans+Mono:wght@400;700&display=swap",
  },
  {
    id: "victor-mono",
    label: "Victor Mono",
    stylesheet: "https://fonts.googleapis.com/css2?family=Victor+Mono:wght@400;700&display=swap",
  },
  {
    id: "intel-one-mono",
    label: "Intel One Mono",
    stylesheet: "https://fonts.googleapis.com/css2?family=Intel+One+Mono:wght@400;700&display=swap",
  },
  {
    id: "iosevka-charon-mono",
    label: "Iosevka Charon Mono",
    stylesheet:
      "https://fonts.googleapis.com/css2?family=Iosevka+Charon+Mono:wght@400;700&display=swap",
  },
] as const;

export type CodeFontFamily = "system" | "courier" | (typeof googleCodeFonts)[number]["id"];

export function isCodeFontFamily(value: unknown): value is CodeFontFamily {
  return (
    value === "system" || value === "courier" || googleCodeFonts.some((font) => font.id === value)
  );
}

export function googleFontStylesheet(family: CodeFontFamily): string | null {
  return googleCodeFonts.find((font) => font.id === family)?.stylesheet ?? null;
}
