import { responseBody } from "./api.ts";
import { projectApiUrl } from "@git-review/shared/project-path";
import {
  maxFeedbackCheckBodyBytes,
  parseFeedbackCheckRequest,
  parseFeedbackCheckResponse,
  type FeedbackAnchor,
} from "@git-review/shared/feedback-check";

export async function checkFeedbackSources(
  projectPath: string,
  anchors: readonly FeedbackAnchor[],
  signal: AbortSignal,
): Promise<boolean[]> {
  const request = parseFeedbackCheckRequest({ anchors });
  const body = JSON.stringify(request);
  if (new Blob([body]).size > maxFeedbackCheckBodyBytes)
    throw new Error(
      "Feedback contains too much saved source to check together. Remove some drafts and retry.",
    );
  const response = await fetch(projectApiUrl("/feedback/check", projectPath), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal,
    cache: "no-store",
  });
  const result = parseFeedbackCheckResponse(await responseBody(response), anchors.length);
  if (result.kind === "stale") throw new Error("The files changed during checking. Try again.");
  return result.matches;
}
