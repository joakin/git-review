import { isRecord } from "@git-review/shared/validation";

export type HeldResource = "file" | "diff" | "feedback" | "media";

/** Deliberately equal paths/version tokens with distinguishable fixture content. */
export class AgentStateFixture {
  rootUnavailable = false;
  private next: HeldResource | null = null;
  private pending = new Map<HeldResource, { release: () => void }>();
  private listeners = new Map<HeldResource, () => void>();

  holdNext(resource: HeldResource): Promise<void> {
    if (this.next !== null || this.pending.has(resource))
      throw new Error("A hold is already pending");
    this.next = resource;
    return new Promise((resolve) => this.listeners.set(resource, resolve));
  }
  release(resource: HeldResource): void {
    this.pending.get(resource)?.release();
    this.pending.delete(resource);
  }
  releaseAll(): void {
    for (const resource of this.pending.keys()) this.release(resource);
  }

  async decorate(agent: string, request: Request, response: Response): Promise<Response> {
    const url = new URL(request.url);
    if (agent === "b" && this.rootUnavailable && url.pathname === "/api/roots")
      return Response.json(
        { error: { code: "unavailable", message: "Controlled root unavailable" } },
        { status: 503 },
      );
    const kind: HeldResource | null =
      url.pathname === "/api/project/file"
        ? "file"
        : url.pathname === "/api/project/diffs"
          ? "diff"
          : url.pathname === "/api/project/feedback/check"
            ? "feedback"
            : url.pathname === "/api/project/raw/file" &&
                request.method === "GET" &&
                url.searchParams.get("path") === "image.svg"
              ? "media"
              : null;
    if (agent === "a" && kind !== null && this.next === kind) {
      this.next = null;
      await new Promise<void>((resolve) => {
        this.pending.set(kind, { release: resolve });
        this.listeners.get(kind)?.();
        this.listeners.delete(kind);
      });
    }
    if (agent !== "b" || !response.ok || request.method === "HEAD") return response;
    if (response.headers.get("content-type")?.startsWith("application/json")) {
      const value: unknown = (await response.json()) as unknown;
      return new Response(JSON.stringify(label(value)), {
        status: response.status,
        headers: response.headers,
      });
    }
    if (url.pathname === "/api/project/raw/file" && url.searchParams.get("path") === "image.svg") {
      const text = (await response.text()).replace("Chosen agent image", "Second agent image");
      return new Response(text, { status: response.status, headers: response.headers });
    }
    return response;
  }
}

function label(value: unknown): unknown {
  if (typeof value === "string")
    return value
      .replaceAll("transportLine", "cloudHostLine")
      .replaceAll("Transport fixture", "Second agent fixture");
  if (Array.isArray(value)) return value.map(label);
  if (isRecord(value))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, label(item)]));
  return value;
}
