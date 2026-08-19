import { describe, it, expect } from "vitest";
import { tokenizeCommand, withTimeout } from "../util.js";

describe("tokenizeCommand", () => {
  it("splits simple space-separated tokens", () => {
    expect(tokenizeCommand("npx -y @modelcontextprotocol/server-github")).toEqual([
      "npx",
      "-y",
      "@modelcontextprotocol/server-github",
    ]);
  });

  it("handles double-quoted strings", () => {
    expect(tokenizeCommand('node "my server.js"')).toEqual(["node", "my server.js"]);
  });

  it("handles single-quoted strings", () => {
    expect(tokenizeCommand("node 'my server.js'")).toEqual(["node", "my server.js"]);
  });

  it("handles attached quotes without spaces", () => {
    expect(tokenizeCommand('server --path="a b"')).toEqual(["server", "--path=a b"]);
  });

  it("handles mixed attached quotes", () => {
    expect(tokenizeCommand("foo'bar baz'")).toEqual(["foobar baz"]);
  });

  it("handles double quote attached to word", () => {
    expect(tokenizeCommand('node"script.js"')).toEqual(["nodescript.js"]);
  });

  it("handles empty input", () => {
    expect(tokenizeCommand("")).toEqual([]);
  });

  it("handles whitespace-only input", () => {
    expect(tokenizeCommand("   ")).toEqual([]);
  });

  it("handles escape sequences in double quotes", () => {
    expect(tokenizeCommand('"hello \\"world\\""')).toEqual(['hello "world"']);
  });

  it("handles backslash-escaped backslash in double quotes", () => {
    expect(tokenizeCommand('"path\\\\to\\\\file"')).toEqual(["path\\to\\file"]);
  });

  it("handles multiple tokens with mixed quoting", () => {
    expect(tokenizeCommand('a "b c" d \'e f\'')).toEqual(["a", "b c", "d", "e f"]);
  });

  it("handles tab-separated tokens", () => {
    expect(tokenizeCommand("a\tb\tc")).toEqual(["a", "b", "c"]);
  });

  it("handles trailing spaces", () => {
    expect(tokenizeCommand("node server.js  ")).toEqual(["node", "server.js"]);
  });

  it("handles leading spaces", () => {
    expect(tokenizeCommand("  node server.js")).toEqual(["node", "server.js"]);
  });

  it("treats single quotes literally (no escaping inside single quotes)", () => {
    expect(tokenizeCommand("echo 'it''s me'")).toEqual(["echo", "its me"]);
  });

  it("does not expand environment variables (literal $VAR)", () => {
    process.env.TEST_VAR = "value";
    expect(tokenizeCommand("echo $TEST_VAR")).toEqual(["echo", "$TEST_VAR"]);
    delete process.env.TEST_VAR;
  });

  it("handles commands with equals in value", () => {
    expect(tokenizeCommand("server --config=key=value")).toEqual(["server", "--config=key=value"]);
  });
});

describe("withTimeout", () => {
  it("resolves with the value when the promise settles in time", async () => {
    const result = await withTimeout(Promise.resolve(42), 100, "fast");
    expect(result).toBe(42);
  });

  it("rejects with a timeout error when the promise is too slow", async () => {
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 500));
    await expect(withTimeout(slow, 20, "slow op")).rejects.toThrow(/slow op timed out/);
  });
});
