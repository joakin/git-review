import { expect, test } from "bun:test";
import { parseAgentConfig } from "./config.ts";

test("agent configuration preserves loopback defaults and explicit root/ephemeral port", () => {
  expect(parseAgentConfig([], {}, "/workspace")).toEqual({
    root: "/workspace",
    port: 3000,
    hostname: "127.0.0.1",
    publicOrigin: null,
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
  });
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
