import { expect, test } from "bun:test";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { parseAgentInfoResponse } from "@git-review/shared/agent-info";
import { createApiHandler } from "./api.ts";
import { approveRoot } from "./paths.ts";
import { withTempDirectory } from "../../../qa/test-support.ts";

test("handshake remains useful without repository resolution and does not disclose host configuration", async () => {
  await withTempDirectory("git-review-information-", async (directory) => {
    const path = join(directory, "approved");
    await mkdir(path);
    const handle = createApiHandler(await approveRoot(path), "https://private.ts.net", [
      "https://review.example",
    ]);
    await rename(path, join(directory, "moved"));
    const response = await handle(
      new Request("http://127.0.0.1:3000/api/info", {
        headers: { origin: "https://review.example" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://review.example");
    const text = await response.text();
    const handshake = parseAgentInfoResponse(JSON.parse(text) as unknown);
    expect(handshake.kind).toBe("compatible");
    expect(text).not.toContain(path);
    expect(text).not.toContain("private.ts.net");
    expect(text).not.toContain("review.example");
    expect(
      (await handle(new Request("http://127.0.0.1:3000/api/info?projectPath=/ignored"))).status,
    ).toBe(400);
  });
});
