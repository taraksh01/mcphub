import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ConfigManager } from "../config.js";

const TEST_DIR = join(tmpdir(), `mcphub-test-${Date.now()}`);
const TEST_CONFIG = join(TEST_DIR, "config.json");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("ConfigManager", () => {
  describe("load - Fix #8 (ENOENT silent defaults)", () => {
    it("returns defaults when config file does not exist", () => {
      const mgr = new ConfigManager(join(TEST_DIR, "nonexistent.json"));
      expect(mgr.get().port).toBe(5431);
      expect(mgr.get().mcpServers).toEqual({});
    });

    it("returns defaults when config is invalid JSON", () => {
      writeFileSync(TEST_CONFIG, "not json");
      const mgr = new ConfigManager(TEST_CONFIG);
      expect(mgr.get().port).toBe(5431);
    });

    it("loads valid config", () => {
      writeFileSync(TEST_CONFIG, JSON.stringify({ port: 8080, mcpServers: {} }));
      const mgr = new ConfigManager(TEST_CONFIG);
      expect(mgr.get().port).toBe(8080);
    });
  });

  describe("parse - Fix #7 (reject ':' in server names)", () => {
    it("rejects server names with colons", () => {
      writeFileSync(TEST_CONFIG, JSON.stringify({
        port: 5431,
        mcpServers: { "bad:name": { type: "stdio", command: "echo" } },
      }));
      const mgr = new ConfigManager(TEST_CONFIG);
      expect(mgr.get().mcpServers).toEqual({});
    });

    it("accepts valid server names", () => {
      writeFileSync(TEST_CONFIG, JSON.stringify({
        port: 5431,
        mcpServers: { "my-server": { type: "stdio", command: "echo" } },
      }));
      const mgr = new ConfigManager(TEST_CONFIG);
      expect(mgr.get().mcpServers["my-server"]).toBeDefined();
    });
  });

  describe("reload - Fix #5 (tolerant reload)", () => {
    it("returns null and keeps current config on invalid reload", () => {
      writeFileSync(TEST_CONFIG, JSON.stringify({ port: 9999, mcpServers: {} }));
      const mgr = new ConfigManager(TEST_CONFIG);
      expect(mgr.get().port).toBe(9999);

      writeFileSync(TEST_CONFIG, "invalid!!!");
      const result = mgr.reload();
      expect(result).toBeNull();
      expect(mgr.get().port).toBe(9999);
    });

    it("returns new config on valid reload", () => {
      writeFileSync(TEST_CONFIG, JSON.stringify({ port: 9999, mcpServers: {} }));
      const mgr = new ConfigManager(TEST_CONFIG);
      expect(mgr.get().port).toBe(9999);

      writeFileSync(TEST_CONFIG, JSON.stringify({ port: 7777, mcpServers: {} }));
      const result = mgr.reload();
      expect(result).not.toBeNull();
      expect(result!.port).toBe(7777);
    });
  });

  describe("stopWatching - Fix #12 (clear debounce)", () => {
    it("can be called without error even if never started", () => {
      const mgr = new ConfigManager(TEST_CONFIG);
      expect(() => mgr.stopWatching()).not.toThrow();
    });
  });

  describe("atomic save", () => {
    it("saves config atomically via tmp file", () => {
      const mgr = new ConfigManager(TEST_CONFIG);
      mgr.updateServer("test", { type: "stdio", command: "echo" });
      const reloaded = new ConfigManager(TEST_CONFIG);
      expect(reloaded.get().mcpServers["test"]).toBeDefined();
    });
  });

  describe("parse - type validation", () => {
    it("rejects non-string stdio command", () => {
      const f = join(TEST_DIR, `inv-cmd-${Date.now()}-${Math.random()}.json`);
      writeFileSync(f, JSON.stringify({
        port: 5431,
        mcpServers: { s: { type: "stdio", command: 123 } },
      }));
      const mgr = new ConfigManager(f);
      expect(mgr.get().mcpServers).toEqual({});
    });

    it("rejects non-array stdio args", () => {
      const f = join(TEST_DIR, `inv-args-${Date.now()}-${Math.random()}.json`);
      writeFileSync(f, JSON.stringify({
        port: 5431,
        mcpServers: { s: { type: "stdio", command: "echo", args: "echo" } },
      }));
      const mgr = new ConfigManager(f);
      expect(mgr.get().mcpServers).toEqual({});
    });

    it("rejects non-string http url", () => {
      const f = join(TEST_DIR, `inv-url-${Date.now()}-${Math.random()}.json`);
      writeFileSync(f, JSON.stringify({
        port: 5431,
        mcpServers: { s: { type: "http", url: 42 } },
      }));
      const mgr = new ConfigManager(f);
      expect(mgr.get().mcpServers).toEqual({});
    });

    it("rejects non-string env values", () => {
      const f = join(TEST_DIR, `inv-env-${Date.now()}-${Math.random()}.json`);
      writeFileSync(f, JSON.stringify({
        port: 5431,
        mcpServers: { s: { type: "stdio", command: "echo", env: { K: 1 } } },
      }));
      const mgr = new ConfigManager(f);
      expect(mgr.get().mcpServers).toEqual({});
    });

    it("accepts valid servers with all fields", () => {
      const f = join(TEST_DIR, `valid-${Date.now()}-${Math.random()}.json`);
      writeFileSync(f, JSON.stringify({
        port: 5431,
        mcpServers: { s: { type: "stdio", command: "echo", args: ["a"], env: { K: "v" }, cwd: "/tmp", disabledTools: ["t"] } },
      }));
      const mgr = new ConfigManager(f);
      expect(mgr.get().mcpServers["s"]).toBeDefined();
    });
  });

  describe("parse - rejects invalid structure", () => {
    it("rejects non-number port", () => {
      const f = join(TEST_DIR, `inv-port-${Date.now()}-${Math.random()}.json`);
      writeFileSync(f, JSON.stringify({ port: "nope", mcpServers: {} }));
      const mgr = new ConfigManager(f);
      expect(mgr.get().mcpServers).toEqual({});
    });

    it("rejects non-object mcpServers", () => {
      const f = join(TEST_DIR, `inv-ms-${Date.now()}-${Math.random()}.json`);
      writeFileSync(f, JSON.stringify({ port: 5431, mcpServers: [] }));
      const mgr = new ConfigManager(f);
      expect(mgr.get().mcpServers).toEqual({});
    });
  });

  describe("mutations", () => {
    it("setEnabled toggles enabled flag and persists", () => {
      writeFileSync(TEST_CONFIG, JSON.stringify({ port: 5431, mcpServers: { s: { type: "stdio", command: "echo" } } }));
      const mgr = new ConfigManager(TEST_CONFIG);
      expect(mgr.setEnabled("s", false)).toBe(true);
      const reloaded = new ConfigManager(TEST_CONFIG);
      expect(reloaded.get().mcpServers["s"].enabled).toBe(false);
      expect(mgr.setEnabled("missing", true)).toBe(false);
    });

    it("setToolDisabled adds and removes tools", () => {
      writeFileSync(TEST_CONFIG, JSON.stringify({ port: 5431, mcpServers: { s: { type: "stdio", command: "echo" } } }));
      const mgr = new ConfigManager(TEST_CONFIG);
      expect(mgr.setToolDisabled("s", "foo", true)).toBe(true);
      expect(mgr.get().mcpServers["s"].disabledTools).toEqual(["foo"]);
      expect(mgr.setToolDisabled("s", "foo", false)).toBe(true);
      expect(mgr.get().mcpServers["s"].disabledTools).toBeUndefined();
      expect(mgr.setToolDisabled("missing", "foo", true)).toBe(false);
    });

    it("removeServer deletes a server", () => {
      writeFileSync(TEST_CONFIG, JSON.stringify({ port: 5431, mcpServers: { s: { type: "stdio", command: "echo" } } }));
      const mgr = new ConfigManager(TEST_CONFIG);
      mgr.removeServer("s");
      const reloaded = new ConfigManager(TEST_CONFIG);
      expect(reloaded.get().mcpServers["s"]).toBeUndefined();
    });
  });

  describe("startWatching - Fix #5 (reload callback)", () => {
    it("invokes callback with new config on file change", async () => {
      writeFileSync(TEST_CONFIG, JSON.stringify({ port: 5431, mcpServers: {} }));
      const mgr = new ConfigManager(TEST_CONFIG);
      const seen: number[] = [];
      mgr.startWatching((cfg) => seen.push(cfg.port));
      writeFileSync(TEST_CONFIG, JSON.stringify({ port: 5555, mcpServers: {} }));
      await new Promise((r) => setTimeout(r, 800));
      mgr.stopWatching();
      expect(seen).toContain(5555);
    });
  });
});
