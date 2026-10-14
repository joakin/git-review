import { expect, test } from "bun:test";
import { parseAgentConfig } from "./config.ts";

test("agent configuration preserves loopback defaults and explicit root/ephemeral port", () => {
  expect(parseAgentConfig([], {}, "/workspace")).toEqual({
    root: "/workspace",
    port: 3000,
    hostname: "127.0.0.1",
    publicOrigin: null,
    allowedOrigins: [],
    clientUrl: null,
  });
  expect(
    parseAgentConfig(["--root", "/projects with spaces", "--port", "0"], {
      GIT_REVIEW_HOST: "100.64.1.2",
      GIT_REVIEW_PUBLIC_ORIGIN: "https://workspace.tailnet.ts.net:8443",
    }),
  ).toEqual({
    root: "/projects with spaces",
    port: 0,
    hostname: "100.64.1.2",
    publicOrigin: "https://workspace.tailnet.ts.net:8443",
    allowedOrigins: [],
    clientUrl: null,
  });
});

test("printed connection links require the public agent address and an allowed deployment origin", () => {
  const environment = {
    GIT_REVIEW_PUBLIC_ORIGIN: "https://workspace.tailnet.ts.net",
    GIT_REVIEW_ALLOWED_ORIGINS: '["https://review.example"]',
    GIT_REVIEW_CLIENT_URL: "https://review.example/git-review/",
  };
  expect(parseAgentConfig([], environment).clientUrl).toBe(environment.GIT_REVIEW_CLIENT_URL);
  expect(() =>
    parseAgentConfig([], { ...environment, GIT_REVIEW_PUBLIC_ORIGIN: undefined }),
  ).toThrow("requires");
  expect(() => parseAgentConfig([], { ...environment, GIT_REVIEW_ALLOWED_ORIGINS: "[]" })).toThrow(
    "requires",
  );
});

test("agent configuration rejects incomplete arguments, invalid ports and public bindings", () => {
  for (const args of [["--root"], ["--other", "x"], ["--root", ""], ["--root", "bad\0path"]])
    expect(() => parseAgentConfig(args, {})).toThrow();
  for (const port of ["", " 3000", "+3000", "1.5", "1e3", "-1", "65536", "NaN"])
    expect(() => parseAgentConfig(["--port", port], {})).toThrow("--port");
  for (const host of [
    "0.0.0.0",
    "localhost",
    "::1",
    "192.168.1.1",
    "100.63.1.1",
    "100.128.1.1",
    "100.64.999.1",
  ])
    expect(() => parseAgentConfig([], { GIT_REVIEW_HOST: host })).toThrow("GIT_REVIEW_HOST");
  expect(parseAgentConfig([], { GIT_REVIEW_HOST: "100.127.255.254" }).hostname).toBe(
    "100.127.255.254",
  );
});

test("agent proxy origin is an exact HTTPS origin with no credentials or extra URL fields", () => {
  for (const origin of [
    "",
    "http://host.ts.net",
    "https://host.ts.net/",
    "https://host.ts.net/path",
    "https://user:secret@host.ts.net",
    "https://host.ts.net?x=1",
    "https://host.ts.net#x",
    "https://HOST.ts.net",
    "https://host.ts.net:443",
  ])
    expect(() => parseAgentConfig([], { GIT_REVIEW_PUBLIC_ORIGIN: origin })).toThrow(
      "GIT_REVIEW_PUBLIC_ORIGIN",
    );
});

test("frontend origins require a bounded exact-origin list separate from the proxy address", () => {
  const origins = [
    "https://review.example",
    "http://127.0.0.1:39962",
    "http://localhost:39963",
    "http://[::1]:39964",
  ];
  expect(
    parseAgentConfig([], { GIT_REVIEW_ALLOWED_ORIGINS: JSON.stringify(origins) }).allowedOrigins,
  ).toEqual(origins);
  expect(parseAgentConfig([], { GIT_REVIEW_ALLOWED_ORIGINS: "[]" }).allowedOrigins).toEqual([]);
  for (const raw of [
    "",
    "not JSON",
    '"https://review.example"',
    "null",
    "{}",
    '["https://review.example","https://review.example"]',
    JSON.stringify(Array.from({ length: 9 }, (_, i) => `https://host${i}.example`)),
    " ".repeat(16_385),
  ])
    expect(() => parseAgentConfig([], { GIT_REVIEW_ALLOWED_ORIGINS: raw })).toThrow(
      "GIT_REVIEW_ALLOWED_ORIGINS",
    );
  for (const origin of [
    "*",
    "null",
    5,
    null,
    "http://review.example",
    "https://review.example/",
    "https://review.example/path",
    "https://user:secret@review.example",
    "https://review.example?token=secret",
    "https://REVIEW.example",
    "https://review.example:443",
    "http://127.0.0.2:3000",
  ])
    expect(() =>
      parseAgentConfig([], { GIT_REVIEW_ALLOWED_ORIGINS: JSON.stringify([origin]) }),
    ).toThrow("GIT_REVIEW_ALLOWED_ORIGINS");
});
