const result = await Bun.build({
  entrypoints: ["./src/client/main.tsx", "./src/client/styles.css"],
  outdir: "./dist/assets",
  target: "browser",
  format: "esm",
  jsx: { runtime: "automatic", importSource: "preact" },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exitCode = 1;
} else {
  for (const output of result.outputs) console.log(`Built ${output.path}`);
}
