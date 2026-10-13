import { projectApiUrl } from "@git-review/shared/project-path";
import {
  maxContextBodyBytes,
  maxContextAnchors,
  maxContextResponseBytes,
  parseDiffContextResponse,
  type DiffContextGap,
  type DiffContextRequest,
  type ContextAnchor,
} from "@git-review/shared/diff-context";
import { responseBody } from "./api.ts";

export async function checkContextAnchors(
  projectPath: string,
  file: Omit<Extract<DiffContextRequest, { kind: "check" }>, "kind" | "anchors">,
  anchors: readonly ContextAnchor[],
  signal: AbortSignal,
): Promise<boolean[]> {
  const matches: boolean[] = [];
  let offset = 0;
  while (offset < anchors.length) {
    const batch: ContextAnchor[] = [];
    while (batch.length < maxContextAnchors && offset + batch.length < anchors.length) {
      const anchor = anchors[offset + batch.length];
      if (anchor === undefined) throw new Error("Missing context anchor");
      const candidate = { ...file, kind: "check", anchors: [...batch, anchor] };
      if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > maxContextBodyBytes)
        break;
      batch.push(anchor);
    }
    if (batch.length === 0) throw new Error("Context anchor exceeds the request byte limit");
    const response = await fetchDiffContext(
      projectPath,
      { ...file, kind: "check", anchors: batch },
      null,
      signal,
    );
    if (response.kind === "stale") throw new Error("The files changed during checking. Try again.");
    if (response.kind !== "checked")
      throw new Error("Expanded context could not be checked. Retry before copying.");
    matches.push(...response.matches);
    offset += batch.length;
  }
  return matches;
}

export async function fetchDiffContext(
  projectPath: string,
  request: DiffContextRequest,
  gap: DiffContextGap | null,
  signal: AbortSignal,
) {
  const body = JSON.stringify(request);
  if (new TextEncoder().encode(body).byteLength > maxContextBodyBytes)
    throw new Error("Diff context request exceeds the byte limit");
  const response = await fetch(projectApiUrl("/diff-context", projectPath), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal,
    cache: "no-store",
  });
  if (response.body === null) throw new Error("Missing diff context response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxContextResponseBytes) {
        await reader.cancel();
        throw new Error("Diff context response exceeds the byte limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return parseDiffContextResponse(
    await responseBody(new Response(decoded, { status: response.status })),
    request,
    gap,
  );
}
