import { responseBody } from "./api.ts";
import { projectApiUrl } from "../shared/project-path.ts";
import { parseFeedbackCheckResponse, type CommentAnchor } from "../shared/feedback-check.ts";

export async function checkFeedbackSources(
  projectPath: string,
  anchors: readonly CommentAnchor[],
  signal: AbortSignal,
): Promise<boolean[]> {
  const response = await fetch(projectApiUrl("/feedback/check", projectPath), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ anchors }),
    signal,
    cache: "no-store",
  });
  const result = parseFeedbackCheckResponse(await responseBody(response), anchors.length);
  if (result.kind === "stale") throw new Error("The files changed during checking. Try again.");
  return result.matches;
}
