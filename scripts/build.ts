await import("./build-local.ts");
if (process.exitCode !== 1) {
  await import("./build-web.ts");
  await import("./build-agent.ts");
}
