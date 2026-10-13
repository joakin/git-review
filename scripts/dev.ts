await import("./build.ts");
if (process.exitCode !== 1) await import("./serve.ts");
