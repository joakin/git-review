import { isAbsolute } from "node:path";
import { parseClientUrl } from "@git-review/shared/connection-link";
import { expectRecord } from "@git-review/shared/validation";
import { parseAgentConfig } from "./config.ts";

export function parseCloudConfig(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
) {
  const clientUrl = parseClientUrl(environment["GIT_REVIEW_CLIENT_URL"]);
  const authKey = environment["TS_AUTHKEY"];
  if (authKey === undefined || !/^tskey-auth-[a-zA-Z0-9_-]{1,2048}$/.test(authKey))
    throw new Error(
      "TS_AUTHKEY must be a raw Tailscale auth key supplied as a private environment variable",
    );
  const requested = parseAgentConfig(args, {
    ...environment,
    GIT_REVIEW_HOST: "127.0.0.1",
    GIT_REVIEW_PUBLIC_ORIGIN: "https://pending.invalid",
    GIT_REVIEW_ALLOWED_ORIGINS:
      environment["GIT_REVIEW_ALLOWED_ORIGINS"] ?? JSON.stringify([new URL(clientUrl).origin]),
  });
  if (
    environment["GIT_REVIEW_HOST"] !== undefined &&
    environment["GIT_REVIEW_HOST"] !== "127.0.0.1"
  )
    throw new Error("The cloud launcher requires loopback binding behind Tailscale Serve");
  if (requested.port === 0)
    throw new Error("The cloud launcher requires a fixed nonzero loopback port");
  const hostname = environment["GIT_REVIEW_WORKSPACE_NAME"] ?? `review-${crypto.randomUUID()}`;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname))
    throw new Error("GIT_REVIEW_WORKSPACE_NAME must be a unique lowercase DNS label");
  function executable(key: string, fallback: string): string {
    const path = environment[key];
    if (path !== undefined && !isAbsolute(path))
      throw new Error(`${key} must be an absolute executable path`);
    return path ?? fallback;
  }
  return {
    root: requested.root,
    port: requested.port,
    clientUrl,
    allowedOrigins: requested.allowedOrigins,
    authKey,
    hostname,
    tailscale: executable("GIT_REVIEW_TAILSCALE_PATH", "tailscale"),
    tailscaled: executable("GIT_REVIEW_TAILSCALED_PATH", "tailscaled"),
  };
}

/** Only the local node's validated DNS name becomes a browser endpoint. */
export function tailscaleOrigin(value: unknown): string {
  const status = expectRecord(value, "Tailscale status");
  const self = expectRecord(status["Self"], "Tailscale self");
  const raw = self["DNSName"];
  const hostname = typeof raw === "string" ? raw.replace(/\.$/, "").toLowerCase() : "";
  if (
    status["BackendState"] !== "Running" ||
    hostname.length > 253 ||
    !hostname.endsWith(".ts.net") ||
    !hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error("Tailscale is not running with a valid private HTTPS DNS name");
  return `https://${hostname}`;
}

export function cloudChildEnvironment(environment: Readonly<Record<string, string | undefined>>) {
  const clean = { ...environment };
  delete clean["TS_AUTHKEY"];
  return clean;
}
