import type { Appearance, CodeTypography } from "./storage.ts";
import { googleCodeFonts, isCodeFontFamily } from "./code-fonts.ts";

const fontSizes = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

export function SettingsView({ typography, onTypography, appearance, onAppearance, onBack }: {
  typography: CodeTypography;
  onTypography: (next: CodeTypography) => void;
  appearance: Appearance;
  onAppearance: (next: Appearance) => void;
  onBack: () => void;
}) {
  return <section class="settings-view" aria-labelledby="settings-title">
    <button class="settings-back" type="button" onClick={onBack}>← Back to review</button>
    <div class="settings-intro">
      <p class="eyebrow">PERSONAL DISPLAY</p>
      <h1 id="settings-title">Settings</h1>
      <p>Make the interface and code comfortable to read on this device. These choices are saved in this browser.</p>
    </div>
    <div class="settings-panel settings-appearance">
      <div class="settings-panel-head">
        <div><p class="eyebrow">PERSONAL DISPLAY</p><h2>Appearance</h2></div>
        <button class="settings-reset" type="button" onClick={() => onAppearance({ version: 1, appTheme: "light", codeTheme: "match" })}>Reset appearance</button>
      </div>
      <div class="settings-controls">
        <label class="settings-field" for="app-theme"><span>App theme</span>
          <select id="app-theme" value={appearance.appTheme} onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === "light" || value === "dark" || value === "system") onAppearance({ ...appearance, appTheme: value });
          }}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select>
        </label>
        <label class="settings-field" for="code-theme"><span>Code theme</span>
          <select id="code-theme" value={appearance.codeTheme} onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === "match" || value === "light" || value === "dark") onAppearance({ ...appearance, codeTheme: value });
          }}><option value="match">Match app</option><option value="light">Light</option><option value="dark">Dark</option></select>
        </label>
      </div>
      <div class="settings-interface-preview" aria-label="Live interface preview"><span class="settings-interface-preview-label">Interface preview</span><span class="settings-interface-preview-card">Review controls <strong>Update</strong></span></div>
      <p class="settings-help">System follows this device. Match app lets code change with the interface; choose Light or Dark to keep code independent.</p>
    </div>
    <div class="settings-panel">
      <div class="settings-panel-head">
        <div><p class="eyebrow">CODE APPEARANCE</p><h2>Typography</h2></div>
        <button class="settings-reset" type="button" onClick={() => onTypography({ version: 1, fontSize: 12, fontFamily: "system" })}>Reset</button>
      </div>
      <div class="settings-controls">
        <label class="settings-field" for="code-font-size"><span>Font size</span>
          <select id="code-font-size" value={typography.fontSize} onChange={(event) => onTypography({ ...typography, fontSize: Number(event.currentTarget.value) })}>
            {fontSizes.map((size) => <option value={size} key={size}>{size} px</option>)}
          </select>
        </label>
        <label class="settings-field" for="code-font-family"><span>Font family</span>
          <select id="code-font-family" value={typography.fontFamily} onChange={(event) => {
            const family = event.currentTarget.value;
            if (isCodeFontFamily(family)) onTypography({ ...typography, fontFamily: family });
          }}>
            <option value="system">System mono</option>
            <option value="courier">Courier</option>
            {googleCodeFonts.map((font) => <option value={font.id} key={font.id}>{font.label} · Google Fonts</option>)}
          </select>
        </label>
      </div>
      <div class="settings-preview" aria-label="Live code preview">
        <div class="settings-preview-heading"><span>Live preview</span><span>sample.ts</span></div>
        <div class="settings-preview-line settings-preview-removed"><span aria-hidden="true">−</span><code><span class="syntax-token-keyword">const</span> result = render(oldValue);</code></div>
        <div class="settings-preview-line settings-preview-added"><span aria-hidden="true">+</span><code><span class="syntax-token-keyword">const</span> result = render(nextValue);</code></div>
        <div class="settings-preview-line"><span aria-hidden="true"> </span><code><span class="syntax-token-comment">// Ready for review</span></code></div>
      </div>
      <p class="settings-help">Typography changes code in Changes and Files. Interface text keeps its current size. Google fonts load from Google when selected and use a local fallback offline.</p>
    </div>
  </section>;
}
