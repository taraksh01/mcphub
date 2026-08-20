import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ConfigManager } from "../config.js";

function createTestDir(): { dir: string; config: string } {
  const dir = join(tmpdir(), `mcphub-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return { dir, config: join(dir, "config.json") };
}

const TEST_CONFIG = join(tmpdir(), "mcphub-config.json");
const TEST_DIR = tmpdir();

describe.sequential("ConfigManager", () => {
  describe("load - Fix #8 (ENOENT silent defaults)", () => {
    it("returns defaults when config file does not exist", () => {
      const { dir } = createTestDir();
      const mgr = new ConfigManager(join(dir, "nonexistent.json"));
      expect(mgr.get().port).toBe(5431);
      expect(mgr.get().mcpServers).toEqual({});
      rmSync(dir, { recursive: true, force: true });
    });

    it("returns defaults when config is invalid JSON", () => {
      const { dir, config } = createTestDir();
      writeFileSync(config, "not json");
      const mgr = new ConfigManager(config);
      expect(mgr.get().port).toBe(5431);
      rmSync(dir, { recursive: true, force: true });
    });

    it("loads valid config", () => {
      const { dir, config } = createTestDir();
      writeFileSync(config, JSON.stringify({ port: 8080, mcpServers: {} }));
      const mgr = new ConfigManager(config);
      expect(mgr.get().port).toBe(8080);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("parse - Fix #7 (reject ':' in server names)", () => {
    it("rejects server names with colons", () => {
      const { dir, config } = createTestDir();
      writeFileSync(config, JSON.stringify({
        port: 5431,
        mcpServers: { "bad:name": { type: "stdio", command: "echo" } },
      }));
      const mgr = new ConfigManager(config);
      expect(mgr.get().mcpServers).toEqual({});
      rmSync(dir, { recursive: true, force: true });
    });

    it("accepts valid server names", () => {
      const { dir, config } = createTestDir();
      writeFileSync(config, JSON.stringify({
        port: 5431,
        mcpServers: { "my-server": { type: "stdio", command: "echo" } },
      }));
      const mgr = new ConfigManager(config);
      expect(mgr.get().mcpServers["my-server"]).toBeDefined();
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("reload - Fix #5 (tolerant reload)", () => {
    it("returns null and keeps current config on invalid reload", () => {
      const { dir, config } = createTestDir();
      writeFileSync(config, JSON.stringify({ port: 9999, mcpServers: {} }));
      const mgr = new ConfigManager(config);
      expect(mgr.get().port).toBe(9999);

      writeFileSync(config, "invalid!!!");
      const result = mgr.reload();
      expect(result).toBeNull();
      expect(mgr.get().port).toBe(9999);
      rmSync(dir, { recursive: true, force: true });
    });

    it("returns new config on valid reload", () => {
      const { dir, config } = createTestDir();
      writeFileSync(config, JSON.stringify({ port: 9999, mcpServers: {} }));
      const mgr = new ConfigManager(config);
      expect(mgr.get().port).toBe(9999);

      writeFileSync(config, JSON.stringify({ port: 7777, mcpServers: {} }));
      const result = mgr.reload();
      expect(result).not.toBeNull();
      expect(result!.port).toBe(7777);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("stopWatching - Fix #12 (clear debounce)", () => {
    it("can be called without error even if never started", () => {
      const { dir, config } = createTestDir();
      const mgr = new ConfigManager(config);
      expect(() => mgr.stopWatching()).not.toThrow();
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("atomic save", () => {
    it("saves config atomically via tmp file", () => {
      const { dir, config } = createTestDir();
      const mgr = new ConfigManager(config);
      mgr.updateServer("test", { type: "stdio", command: "echo" });
      const reloaded = new ConfigManager(config);
      expect(reloaded.get().mcpServers["test"]).toBeDefined();
      rmSync(dir, { recursive: true, force: true });
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

  describe("parse - new validation rules", () => {
    it("rejects stdio server without command", () => {
      const { dir, config } = createTestDir();
      writeFileSync(config, JSON.stringify({
        port: 5431,
        mcpServers: { "test": { type: "stdio" } },
      }));
      const mgr = new ConfigManager(config);
      expect(mgr.get().mcpServers).toEqual({});
      rmSync(dir, { recursive: true, force: true });
    });

    it("rejects http server without url", () => {
      const { dir, config } = createTestDir();
      writeFileSync(config, JSON.stringify({
        port: 5431,
        mcpServers: { "test": { type: "http" } },
      }));
      const mgr = new ConfigManager(config);
      expect(mgr.get().mcpServers).toEqual({});
      rmSync(dir, { recursive: true, force: true });
    });

    it("rejects http server with invalid url", () => {
      const { dir, config } = createTestDir();
      writeFileSync(config, JSON.stringify({
        port: 5431,
        mcpServers: { "test": { type: "http", url: "not-a-url" } },
      }));
      const mgr = new ConfigManager(config);
      expect(mgr.get().mcpServers).toEqual({});
      rmSync(dir, { recursive: true, force: true });
    });

    it("accepts valid stdio server with command", () => {
      const { dir, config } = createTestDir();
      writeFileSync(config, JSON.stringify({
        port: 5431,
        mcpServers: { "test": { type: "stdio", command: "echo" } },
      }));
      const mgr = new ConfigManager(config);
      expect(mgr.get().mcpServers["test"]).toBeDefined();
      rmSync(dir, { recursive: true, force: true });
    });

    it("accepts valid http server with url", () => {
      const { dir, config } = createTestDir();
      writeFileSync(config, JSON.stringify({
        port: 5431,
        mcpServers: { "test": { type: "http", url: "https://example.com/mcp" } },
      }));
      const mgr = new ConfigManager(config);
      expect(mgr.get().mcpServers["test"]).toBeDefined();
      rmSync(dir, { recursive: true, force: true });
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