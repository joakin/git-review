import { useState } from "preact/hooks";
import type { LanguageOption } from "../shared/api.ts";
import { readLanguageOverride, saveLanguageOverride } from "./storage.ts";

export function useLanguageOverride(
  projectId: string,
  path: string,
  languages: readonly LanguageOption[],
) {
  const [override, setOverride] = useState<string | null>(() =>
    readLanguageOverride(projectId, path),
  );
  const effectiveOverride =
    override === null ||
    override === "text" ||
    languages.some((language) => language.id === override)
      ? override
      : null;

  return {
    override,
    effectiveOverride,
    changeLanguage: (value: string | null) => {
      setOverride(value);
      saveLanguageOverride(projectId, path, value);
    },
  };
}
