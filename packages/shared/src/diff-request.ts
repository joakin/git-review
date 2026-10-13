import { gitPath } from "./git.ts";
import { expectString } from "./validation.ts";

export type DiffFileRequest = { path: string; language: string | null };

export function parseDiffFileFields(file: Record<string, unknown>): DiffFileRequest {
  const language =
    file["language"] === null ? null : expectString(file["language"], "language override");
  if (language !== null && (language.length === 0 || language.length > 100))
    throw new Error("Invalid language override");
  return { path: gitPath(file["path"]), language };
}
