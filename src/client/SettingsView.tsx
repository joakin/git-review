import type { CodeTypography } from "./storage.ts";
import { googleCodeFonts, isCodeFontFamily } from "./code-fonts.ts";

const fontSizes = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

export function SettingsView({ typography, onTypography, onBack }: {
  typography: CodeTypography;
  onTypography: (next: CodeTypography) => void;
  onBack: () => void;
}) {
  return <section class="settings-view" aria-labelledby="settings-title">
    <button class="settings-back" type="button" onClick={onBack}>← Back to review</button>
    <div class="settings-intro">
      <p class="eyebrow">PERSONAL DISPLAY</p>
      <h1 id="settings-title">Settings</h1>
      <p>Make code comfortable to read on this device. These choices are saved in this browser.</p>
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
      <p class="settings-help">The setting changes code in Changes and Files. Interface text keeps its current size. Google fonts load from Google when selected and use a local fallback offline.</p>
    </div>
  </section>;
}
