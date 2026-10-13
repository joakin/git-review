import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveRoot, listDirectory, resolveProject, resolveDirectory } from "./paths.ts";

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
    expect((await resolveProject(root, root.realPath + "/nested")).relativePath).toBe("nested");

    await expect(resolveDirectory(root, "../outside")).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(resolveDirectory(root, "/outside")).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(resolveDirectory(root, "escape")).rejects.toMatchObject({ code: "forbidden" });
    await expect(resolveDirectory(root, "missing")).rejects.toMatchObject({ code: "not_found" });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("absolute projects resolve independently and enforce canonical approved locations", async () => {
  const base = await mkdtemp(join(tmpdir(), "git-review-absolute-project-"));
  try {
    const allowed = join(base, "allowed");
    await mkdir(allowed);
    const root = await approveRoot(allowed);
    const name = "odd #?% 雪 folder";
    const folder = join(root.realPath, name);
    await mkdir(folder);
    const expected = { name, relativePath: name, absolutePath: folder };
    expect(await resolveProject(root, folder)).toEqual(expected);
    expect((await resolveProject(root, root.realPath)).relativePath).toBe("");
    // A fresh root/resolver has no registration to restore.
    expect(await resolveProject(await approveRoot(allowed), folder)).toEqual(expected);
    for (const input of [
      null,
      "relative",
      "",
      `${folder}/`,
      `${folder}/../`,
      "a".repeat(4097),
      `${folder}\0`,
    ])
      await expect(resolveProject(root, input)).rejects.toMatchObject({ code: "invalid_request" });
    await mkdir(join(base, "allowed-sibling"));
    await expect(resolveProject(root, join(base, "allowed-sibling"))).rejects.toMatchObject({
      code: "forbidden",
    });
    await symlink(folder, join(allowed, "alias"));
    await expect(resolveProject(root, join(root.realPath, "alias"))).rejects.toMatchObject({
      code: "project_changed",
    });
    expect(await resolveProject(root, join(root.realPath, "alias"), false)).toEqual(expected);
    await symlink(join(base, "allowed-sibling"), join(allowed, "escape"));
    await expect(resolveProject(root, join(root.realPath, "escape"), false)).rejects.toMatchObject({
      code: "forbidden",
    });
    await writeFile(join(allowed, "file"), "text");
    await expect(resolveProject(root, join(root.realPath, "file"))).rejects.toMatchObject({
      code: "project_not_found",
    });
    await rename(folder, join(root.realPath, "moved"));
    await expect(resolveProject(root, folder)).rejects.toMatchObject({ code: "project_not_found" });
    await symlink(join(root.realPath, "moved"), folder);
    await expect(resolveProject(root, folder)).rejects.toMatchObject({ code: "project_changed" });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
