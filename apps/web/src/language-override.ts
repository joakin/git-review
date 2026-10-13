import { useState } from "preact/hooks";
import type { LanguageOption } from "@git-review/shared/api";
import { useProjectState } from "./AgentApiProvider.tsx";

export function useLanguageOverride(
  projectPath: string,
  path: string,
  languages: readonly LanguageOption[],
) {
  const storage = useProjectState();
  const [override, setOverride] = useState<string | null>(() =>
    storage.readLanguageOverride(projectPath, path),
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
      storage.saveLanguageOverride(projectPath, path, value);
    },
  };
}
