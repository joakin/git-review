import { expect, test } from "bun:test";
import { parseDiffResponse, parseFileReadResponse } from "./api.ts";
import { projectApiUrl } from "./project-path.ts";

const projectPath = "/root/project #?% 雪";
const path = "literal\\folder/odd #?% file.svg";
const urls = [
  projectApiUrl("/raw/file", projectPath, { path, version: "a".repeat(20) }),
  projectApiUrl("/raw/diff", projectPath, {
    path,
    layer: "unstaged",
    revision: "a".repeat(20),
    side: "new",
    version: "b".repeat(20),
  }),
  projectApiUrl("/raw/commit", projectPath, {
    path,
    commit: "a".repeat(40),
    side: "old",
    version: "b".repeat(40),
  }),
];
const types = [
  { kind: "image", mimeType: "image/png" },
  { kind: "image", mimeType: "image/jpeg" },
  { kind: "image", mimeType: "image/gif" },
  { kind: "image", mimeType: "image/webp" },
  { kind: "image", mimeType: "image/avif" },
  { kind: "image", mimeType: "image/svg+xml" },
  { kind: "audio", mimeType: "audio/mpeg" },
  { kind: "audio", mimeType: "audio/mp4" },
  { kind: "audio", mimeType: "audio/wav" },
  { kind: "audio", mimeType: "audio/ogg" },
  { kind: "video", mimeType: "video/mp4" },
  { kind: "video", mimeType: "video/webm" },
  { kind: "video", mimeType: "video/quicktime" },
];
const resource = { kind: "image", mimeType: "image/svg+xml", byteLength: 100, url: urls[0] };
const boundaries = [
  {
    name: "Files",
    parse: parseFileReadResponse,
    response: (resource: Record<string, unknown>) => ({
      kind: "media",
      path,
      byteLength: resource["byteLength"],
      resource,
    }),
  },
  {
    name: "diff",
    parse: parseDiffResponse,
    response: (resource: Record<string, unknown>) => ({
      kind: "media",
      old: { kind: "absent" },
      new: { kind: "ready", path, resource },
    }),
  },
];

for (const boundary of boundaries) {
  test(`${boundary.name} media accepts each correlated kind/MIME, inclusive byte limit and raw source`, () => {
    for (const type of types)
      for (const byteLength of [1, (type.kind === "image" ? 25 : 200) * 1024 * 1024])
        for (const url of urls) {
          const response = boundary.response({ ...type, byteLength, url });
          expect<unknown>(boundary.parse(response)).toEqual(response);
        }
  });

  test(`${boundary.name} media rejects unsupported or mismatched kinds, MIME types and byte lengths`, () => {
    for (const type of types) {
      for (const kind of ["image", "audio", "video"])
        if (kind !== type.kind)
          expect(() => boundary.parse(boundary.response({ ...resource, ...type, kind }))).toThrow();
      expect(() =>
        boundary.parse(
          boundary.response({
            ...resource,
            ...type,
            byteLength: (type.kind === "image" ? 25 : 200) * 1024 * 1024 + 1,
          }),
        ),
      ).toThrow();
    }
    for (const kind of [undefined, null, 1, "", "Image", "gif"])
      expect(() => boundary.parse(boundary.response({ ...resource, kind }))).toThrow();
    for (const mimeType of [
      undefined,
      null,
      1,
      "",
      "image/jpg",
      "audio/x-wav",
      "video/avi",
      "image/PNG",
      "image/svg+xml; charset=utf-8",
    ])
      expect(() => boundary.parse(boundary.response({ ...resource, mimeType }))).toThrow();
    for (const byteLength of [undefined, null, "100", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => boundary.parse(boundary.response({ ...resource, byteLength }))).toThrow();
  });

  test(`${boundary.name} media requires a same-origin raw URL with exactly one valid project identity`, () => {
    for (const url of [
      undefined,
      null,
      1,
      "",
      "/api/project/raw/file",
      "/api/project/raw/other?projectPath=%2Froot",
      "/api/project/raw/%66ile?projectPath=%2Froot",
      "https://other.example" + urls[0],
      "//other.example" + urls[0],
      "/api/projects/old/raw/file?projectPath=%2Froot",
      "/api/project/raw/file?path=art.svg",
      "/api/project/raw/file?projectPath=relative",
      "/api/project/raw/file?projectPath=%2Froot%2F..%2Fproject",
      urls[0] + "&projectPath=" + encodeURIComponent(projectPath),
      urls[0] + "#fragment",
      urls[0] + "\r\n",
      urls[0] + "\\suffix",
    ])
      expect(() => boundary.parse(boundary.response({ ...resource, url }))).toThrow();
  });
}

test("Files media requires the outer byte length to match its resource", () => {
  expect(() => parseFileReadResponse({ kind: "media", path, byteLength: 99, resource })).toThrow();
});
