await import("./build.ts");
if (process.exitCode !== 1) await import("../src/server/main.ts");
