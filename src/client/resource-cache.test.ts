import { describe, expect, test } from "bun:test";
import { ResourceCache } from "./resource-cache.ts";

describe("bounded resource cache", () => {
  test("reading promotes a hit while a miss leaves the eviction order alone", () => {
    const cache = new ResourceCache<string>(2, 1024);
    cache.remember("a", "first");
    cache.remember("b", "second");
    expect(cache.read("missing")).toBeNull();
    cache.remember("c", "third");
    expect(cache.read("a")).toBeNull();
    expect(cache.read("b")).toBe("second");
    cache.remember("d", "fourth");
    expect(cache.read("c")).toBeNull();
    expect(cache.read("b")).toBe("second");
    expect(cache.read("d")).toBe("fourth");
  });

  test("replacement becomes most recent without consuming another entry", () => {
    const cache = new ResourceCache<string>(2, 1024);
    cache.remember("a", "first");
    cache.remember("b", "second");
    cache.remember("a", "replacement");
    cache.remember("c", "third");
    expect(cache.read("b")).toBeNull();
    expect(cache.read("a")).toBe("replacement");
    expect(cache.read("c")).toBe("third");
  });

  test("replacement credits old bytes when growing or shrinking", () => {
    // Serialized strings include their quotes: "a" is 6 estimated bytes.
    const growing = new ResourceCache<string>(10, 18);
    growing.remember("a", "aa");
    growing.remember("b", "bb");
    growing.remember("a", "aaaa");
    growing.remember("c", "c");
    expect(growing.read("b")).toBeNull();
    expect(growing.read("a")).toBe("aaaa");
    expect(growing.read("c")).toBe("c");

    const shrinking = new ResourceCache<string>(10, 18);
    shrinking.remember("a", "aaaa");
    shrinking.remember("b", "b");
    shrinking.remember("a", "a");
    shrinking.remember("c", "c");
    expect(shrinking.read("b")).toBe("b");
    expect(shrinking.read("a")).toBe("a");
    expect(shrinking.read("c")).toBe("c");
  });

  test("removal releases its byte charge exactly once", () => {
    const cache = new ResourceCache<string>(10, 20);
    cache.remember("a", "aa");
    cache.remember("b", "b");
    cache.remove("a");
    cache.remove("a");
    cache.remember("c", "ccc");
    cache.remember("d", "d");
    expect(cache.read("a")).toBeNull();
    expect(cache.read("b")).toBeNull();
    expect(cache.read("c")).toBe("ccc");
    expect(cache.read("d")).toBe("d");
  });

  test("accepts the exact UTF-16 byte limit and rejects one byte below it", () => {
    // JSON's two quotes and the emoji's surrogate pair occupy four code units.
    const exact = new ResourceCache<string>(2, 8);
    exact.remember("emoji", "🙂");
    expect(exact.read("emoji")).toBe("🙂");
    const tooSmall = new ResourceCache<string>(2, 7);
    tooSmall.remember("emoji", "🙂");
    expect(tooSmall.read("emoji")).toBeNull();
  });

  test("byte pressure can evict several oldest entries", () => {
    const cache = new ResourceCache<string>(10, 20);
    for (const key of ["a", "b", "c"]) cache.remember(key, key);
    cache.remember("d", "dddddd");
    for (const key of ["a", "b", "c"]) expect(cache.read(key)).toBeNull();
    expect(cache.read("d")).toBe("dddddd");
  });

  test("oversized writes preserve existing values and eviction order", () => {
    const existing = new ResourceCache<string>(2, 6);
    existing.remember("a", "a");
    existing.remember("a", "too large");
    existing.remember("missing", "too large");
    expect(existing.read("a")).toBe("a");
    expect(existing.read("missing")).toBeNull();

    const order = new ResourceCache<string>(2, 12);
    order.remember("a", "a");
    order.remember("b", "b");
    order.remember("a", "too large");
    order.remember("c", "c");
    expect(order.read("a")).toBeNull();
    expect(order.read("b")).toBe("b");
    expect(order.read("c")).toBe("c");
  });
});
