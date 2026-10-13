import { isIP } from "node:net";

export type AgentConfig = {
  readonly root: string;
  readonly port: number;
  readonly hostname: string;
  readonly publicOrigin: string | null;
};

/** Operator configuration is shared by the API-only and temporary same-origin entrypoints. */
export function parseAgentConfig(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd(),
): AgentConfig {
  let root = cwd;
  let port = 3000;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if ((flag !== "--root" && flag !== "--port") || value === undefined)
      throw new Error(`Unknown or incomplete option: ${flag ?? "(missing)"}`);
    if (flag === "--root") {
      if (value === "" || value.includes("\0")) throw new Error("--root must be a folder path");
      root = value;
    } else {
      if (!/^[0-9]+$/.test(value) || Number(value) > 65535)
        throw new Error("--port must be an integer from 0 to 65535");
      port = Number(value);
    }
  }

  const hostname = environment["GIT_REVIEW_HOST"] ?? "127.0.0.1";
  const secondOctet = Number(hostname.split(".")[1]);
  if (
    hostname !== "127.0.0.1" &&
    (isIP(hostname) !== 4 || !hostname.startsWith("100.") || secondOctet < 64 || secondOctet > 127)
  )
    throw new Error("GIT_REVIEW_HOST must be 127.0.0.1 or this host's Tailscale IPv4 address");

  const configuredOrigin = environment["GIT_REVIEW_PUBLIC_ORIGIN"];
  let publicOrigin: string | null = null;
  if (configuredOrigin !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(configuredOrigin);
    } catch {
      throw new Error("GIT_REVIEW_PUBLIC_ORIGIN must be an HTTPS origin without a path");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== configuredOrigin ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    )
      throw new Error("GIT_REVIEW_PUBLIC_ORIGIN must be an HTTPS origin without a path");
    publicOrigin = parsed.origin;
  }
  return { root, port, hostname, publicOrigin };
}
