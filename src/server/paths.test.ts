import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveRoot, listDirectory, openProject, resolveDirectory } from "./paths.ts";

test("folder selection stays inside the approved real path", async () => {
  const base = await mkdtemp(join(tmpdir(), "git-review-paths-"));
  const allowed = join(base, "allowed");
  const outside = join(base, "outside");
  try {
    await mkdir(join(allowed, "nested"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(allowed, "escape"));
    const root = await approveRoot(allowed);

    const listing = await listDirectory(root, "");
    expect(listing.entries).toEqual([{ name: "nested", path: "nested" }]);
    expect((await openProject(root, "nested")).path).toBe("nested");
    expect((await openProject(root, "nested")).id).toBe((await openProject(root, "nested")).id);

    await expect(resolveDirectory(root, "../outside")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(resolveDirectory(root, "/outside")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(resolveDirectory(root, "escape")).rejects.toMatchObject({ code: "forbidden" });
    await expect(resolveDirectory(root, "missing")).rejects.toMatchObject({ code: "not_found" });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
