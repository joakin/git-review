const result = await Bun.build({
  entrypoints: ["./apps/web/src/main.tsx", "./apps/web/src/styles.css"],
  outdir: "./dist/assets",
  target: "browser",
  format: "esm",
  jsx: { runtime: "automatic", importSource: "preact" },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exitCode = 1;
} else {
  const bootstrap = await Bun.build({
    entrypoints: ["./apps/web/src/theme-bootstrap.ts"],
    outdir: "./dist/assets",
    target: "browser",
    format: "iife",
  });
  if (!bootstrap.success) {
    for (const log of bootstrap.logs) console.error(log);
    process.exitCode = 1;
  }
  const worker = await Bun.build({
    entrypoints: ["./apps/web/src/sw.ts"],
    outdir: "./dist/assets",
    target: "browser",
    format: "esm",
  });
  if (!worker.success) {
    for (const log of worker.logs) console.error(log);
    process.exitCode = 1;
  } else {
    for (const output of [...result.outputs, ...bootstrap.outputs, ...worker.outputs])
      console.log(`Built ${output.path}`);
  }
}
