import type { LanguageOption, SyntaxState } from "../shared/api.ts";
import { Chevron } from "./Icons.tsx";
import { SelectControl } from "./SelectControl.tsx";

export function LanguagePicker({
  languages,
  override,
  onChange,
  syntax,
  variant = "row",
}: {
  languages: readonly LanguageOption[];
  override: string | null;
  onChange: (value: string | null) => void;
  syntax: SyntaxState | null;
  variant?: "row" | "compact";
}) {
  if (languages.length === 0) return null;
  const nameFor = (id: string) => languages.find((language) => language.id === id)?.name ?? id;
  const selected =
    override === "text" || languages.some((language) => language.id === override) ? override : null;
  const displayed =
    selected === "text"
      ? "Plain text"
      : selected !== null
        ? nameFor(selected)
        : syntax === null
          ? "Auto"
          : syntax.kind === "highlighted"
            ? nameFor(syntax.language)
            : "Plain text";
  const description = selected === null ? `Auto detect: ${displayed}` : `Language: ${displayed}`;
  const select = (
    <select
      value={selected ?? "auto"}
      title={variant === "compact" ? description : undefined}
      aria-description={variant === "compact" ? description : undefined}
      onChange={(event) =>
        onChange(event.currentTarget.value === "auto" ? null : event.currentTarget.value)
      }
    >
      <option value="auto">Auto detect</option>
      <option value="text">Plain text</option>
      {languages.map((language) => (
        <option key={language.id} value={language.id}>
          {language.name}
        </option>
      ))}
    </select>
  );
  if (variant === "compact") {
    return (
      <label class="language-picker-compact">
        <span class="visually-hidden">Language</span>
        <span class="language-picker-value" aria-hidden="true">
          {displayed}
        </span>
        <Chevron direction="down" />
        {select}
      </label>
    );
  }
  return (
    <div class="diff-language-row">
      <label>
        Language <SelectControl>{select}</SelectControl>
      </label>
      {syntax !== null && (
        <span>{syntax.kind === "highlighted" ? syntax.language : "Plain text"}</span>
      )}
    </div>
  );
}
