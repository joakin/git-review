import { createApiHandler } from "./api.ts";
import { parseAgentConfig } from "./config.ts";
import { approveRoot } from "./paths.ts";
import { agentConnectionLink } from "@git-review/shared/connection-link";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log(`Usage: bun agent.js [--root /path/to/projects] [--port 3000]

Runs the read-only API agent. No frontend assets are served.
Defaults: current folder, port 3000, loopback 127.0.0.1.
Requires Bun and Git; Search requires ripgrep on PATH or GIT_REVIEW_RG_PATH.
GIT_REVIEW_HOST: loopback or this host's Tailscale IPv4 address.
GIT_REVIEW_PUBLIC_ORIGIN: exact HTTPS agent origin used by a private proxy.
GIT_REVIEW_ALLOWED_ORIGINS: JSON array of exact frontend origins (default []).
GIT_REVIEW_CLIENT_URL: optional static HTTPS deployment URL ending in /; prints an Add host link.
Optional voice: GIT_REVIEW_FFMPEG_PATH and GIT_REVIEW_HANDY_PATH.
Voice tools/model are checked only when transcription is requested.`);
} else {
  try {
    const config = parseAgentConfig(args);
    const root = await approveRoot(config.root);
    const handleApiRequest = createApiHandler(root, config.publicOrigin, config.allowedOrigins);
    const server = Bun.serve({
      hostname: config.hostname,
      port: config.port,
      fetch(request) {
        if (new URL(request.url).pathname.startsWith("/api/")) return handleApiRequest(request);
        return new Response("Not found", { status: 404 });
      },
    });
    console.log(`git-review agent: ${server.url.href}`);
    console.log(`Approved root: ${root.realPath}`);
    if (config.publicOrigin !== null) console.log(`Private HTTPS agent: ${config.publicOrigin}`);
    if (config.clientUrl !== null && config.publicOrigin !== null)
      console.log(
        `Open review client: ${agentConnectionLink(config.clientUrl, config.publicOrigin)}`,
      );
    console.log("API only. Transcription requires working FFmpeg, Handy and an installed model.");
  } catch (error: unknown) {
    console.error(`git-review agent: ${error instanceof Error ? error.message : "Startup failed"}`);
    process.exitCode = 1;
  }
}
