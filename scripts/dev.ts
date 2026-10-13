await import("./build-local.ts");
if (process.exitCode !== 1) await import("./serve.ts");
