import { describe, it, expect } from "vitest";
import * as os from "os";
import { parseExport } from "../shellEnv.js";

describe("parseExport (shellEnv)", () => {
  it("parses simple export", () => {
    expect(parseExport("export FOO=bar")).toEqual(["FOO", "bar"]);
  });

  it("strips inline comment outside quotes", () => {
    expect(parseExport("export FOO=bar # comment")).toEqual(["FOO", "bar"]);
  });

  it("preserves # inside double quotes", () => {
    expect(parseExport('export FOO="bar#baz"')).toEqual(["FOO", "bar#baz"]);
  });

  it("preserves # inside single quotes", () => {
    expect(parseExport("export FOO='bar#baz'")).toEqual(["FOO", "bar#baz"]);
  });

  it("expands $HOME inside double quotes", () => {
    const home = os.homedir();
    expect(parseExport('export FOO="$HOME/bin"')).toEqual(["FOO", home + "/bin"]);
  });

  it("expands ${HOME} inside double quotes", () => {
    const home = os.homedir();
    expect(parseExport('export FOO="${HOME}/bin"')).toEqual(["FOO", home + "/bin"]);
  });

  it("expands $VAR in unquoted value", () => {
    process.env.TEST_VAR = "hello";
    expect(parseExport("export FOO=$TEST_VAR")).toEqual(["FOO", "hello"]);
    delete process.env.TEST_VAR;
  });

  it("expands missing $VAR to empty string", () => {
    expect(parseExport("export FOO=$NONEXISTENT_VAR_12345")).toEqual(["FOO", ""]);
  });

  it("does not expand inside single quotes", () => {
    expect(parseExport("export FOO='$HOME'")).toEqual(["FOO", "$HOME"]);
  });

  it("returns null for non-export lines", () => {
    expect(parseExport("FOO=bar")).toBeNull();
  });

  it("returns null for invalid key", () => {
    expect(parseExport("export 123=bar")).toBeNull();
  });

  it("handles empty value", () => {
    expect(parseExport("export FOO=")).toEqual(["FOO", ""]);
  });

  it("handles value with equals sign", () => {
    expect(parseExport("export FOO=bar=baz")).toEqual(["FOO", "bar=baz"]);
  });

  it("handles double-quoted inline comment correctly", () => {
    expect(parseExport('export FOO="bar baz" # comment')).toEqual(["FOO", "bar baz"]);
  });

  it("handles single-quoted inline comment correctly", () => {
    expect(parseExport("export FOO='bar baz' # comment")).toEqual(["FOO", "bar baz"]);
  });

  it("handles export with no value after equals", () => {
    expect(parseExport("export FOO=")).toEqual(["FOO", ""]);
  });

  it("handles key with underscore", () => {
    expect(parseExport("export MY_VAR=value")).toEqual(["MY_VAR", "value"]);
  });

  it("rejects key starting with number", () => {
    expect(parseExport("export 1VAR=value")).toBeNull();
  });

  it("expands $HOME in double quotes (backslash escape not supported)", () => {
    const home = os.homedir();
    // Backslash is not an escape character, so \$HOME becomes \ + expanded $HOME
    expect(parseExport('export FOO="\\$HOME"')).toEqual(["FOO", "\\" + home]);
  });
});
