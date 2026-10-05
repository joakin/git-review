import type { LanguageOption, SyntaxState } from "../shared/api.ts";

export function LanguagePicker({
  languages,
  override,
  onChange,
  syntax,
}: {
  languages: readonly LanguageOption[];
  override: string | null;
  onChange: (value: string | null) => void;
  syntax: SyntaxState | null;
}) {
  if (languages.length === 0) return null;
  return (
    <div class="diff-language-row">
      <label>
        Language{" "}
        <select
          value={override ?? "auto"}
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
      </label>
      {syntax !== null && (
        <span>{syntax.kind === "highlighted" ? syntax.language : "Plain text"}</span>
      )}
    </div>
  );
}
