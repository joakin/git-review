import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const fixture = resolve("qa/.artifacts/media-fixture");
const image = (color: string, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="${color}"/><text x="40" y="190" fill="white" font-size="58" font-family="sans-serif">${label}</text></svg>`;
const git = (...args: string[]) => execFileSync("git", args, { cwd: fixture, stdio: "pipe" });

await mkdir(fixture, { recursive: false });
git("init", "-q");
await writeFile(resolve(fixture, "art.svg"), image("#246b56", "Old · HEAD"));
git("add", "art.svg");
git("-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "-qm", "baseline");
await writeFile(resolve(fixture, "art.svg"), image("#ab6a34", "Staged · index"));
git("add", "art.svg");
await writeFile(
  resolve(fixture, "art.svg"),
  image("#425fa6", "Current · Files").replace(
    "</svg>",
    "<script>document.documentElement.setAttribute('data-script-ran','yes')</script></svg>",
  ),
);
await writeFile(resolve(fixture, "new-image.svg"), image("#a24e7e", "Untracked"));
console.log(`Media fixture ready: ${fixture}`);
