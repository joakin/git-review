import { expect, test } from "bun:test";
import { cloudChildEnvironment, parseCloudConfig, tailscaleOrigin } from "./cloud-config.ts";

const env = {
  TS_AUTHKEY: "tskey-auth-QA-only",
  GIT_REVIEW_CLIENT_URL: "https://example.github.io/git-review/",
};
test("cloud configuration derives exact CORS, keeps loopback binding, and generates independent workspace names", () => {
  const first = parseCloudConfig(["--root", "/workspace/code"], env);
  const second = parseCloudConfig([], env);
  expect(first.allowedOrigins).toEqual(["https://example.github.io"]);
  expect(first.root).toBe("/workspace/code");
  expect(first.port).toBe(3000);
  expect(first.hostname).not.toBe(second.hostname);
  expect(cloudChildEnvironment({ ...env, OTHER_VALUE: "kept" })).toEqual({
    GIT_REVIEW_CLIENT_URL: env.GIT_REVIEW_CLIENT_URL,
    OTHER_VALUE: "kept",
  });
});
test("cloud setup rejects placeholders, exposed binding, bad executable overrides and unapproved frontend configuration", () => {
  for (const patch of [
    { TS_AUTHKEY: "<network-secret-placeholder>" },
    { GIT_REVIEW_HOST: "100.64.0.1" },
    { GIT_REVIEW_CLIENT_URL: "http://remote.example/" },
    { GIT_REVIEW_WORKSPACE_NAME: "same/name" },
    { GIT_REVIEW_TAILSCALE_PATH: "relative/cli" },
    { GIT_REVIEW_ALLOWED_ORIGINS: '["https://other.example"]' },
  ])
    expect(() => parseCloudConfig([], { ...env, ...patch })).toThrow();
  expect(() => parseCloudConfig(["--port", "0"], env)).toThrow();
});
test("Tailscale status accepts only the running self node's private DNS name", () => {
  expect(
    tailscaleOrigin({
      BackendState: "Running",
      Self: { DNSName: "actual-name.tailnet.ts.net." },
      Peer: { DNSName: "other.ts.net" },
    }),
  ).toBe("https://actual-name.tailnet.ts.net");
  for (const value of [
    null,
    {},
    { BackendState: "Stopped", Self: { DNSName: "host.tailnet.ts.net" } },
    ...[
      "host.example.com",
      "host.ts.net/secret",
      "https://host.ts.net",
      "bad..ts.net",
      "-bad.ts.net",
    ].map((DNSName) => ({ BackendState: "Running", Self: { DNSName } })),
  ])
    expect(() => tailscaleOrigin(value)).toThrow();
});
