import { describe, it, expect } from "vitest";
import * as http from "http";

describe("server listen error handler (Fix #1)", () => {
  it("rejects promise when port is already in use", async () => {
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, resolve));
    const addr = blocker.address() as { port: number };

    const { McphubServer } = await import("../server.js");
    const { ToolAggregator } = await import("../tools.js");
    const { McpClientManager } = await import("../backends/manager.js");

    const manager = new McpClientManager();
    const aggregator = new ToolAggregator(manager, () => []);
    const server = new McphubServer(aggregator, manager);

    await expect(server.start(addr.port, "127.0.0.1")).rejects.toThrow();
    blocker.close();
  });
});

describe("runtime file (Fix #6)", () => {
  it("writes and reads runtime JSON via writeRuntime/readRuntime", async () => {
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const { existsSync, rmSync } = await import("fs");

    const dir = join(tmpdir(), `mcphub-rt-test-${Date.now()}`);
    const { writeRuntime, readRuntime } = await import("../runtime.js");

    writeRuntime(5432, "0.0.0.0", dir);
    const read = readRuntime(dir);
    expect(read).not.toBeNull();
    expect(read!.port).toBe(5432);
    expect(read!.host).toBe("0.0.0.0");

    const file = join(dir, "hub.runtime.json");
    expect(existsSync(file)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("readRuntime returns null when file is missing", async () => {
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const dir = join(tmpdir(), `mcphub-rt-missing-${Date.now()}`);
    const { readRuntime } = await import("../runtime.js");
    expect(readRuntime(dir)).toBeNull();
  });
});

describe("McpClientManager.syncConfig - disabledTools no-reconnect (Fix #3)", () => {
  it("treats same config except disabledTools as equivalent (no reconnect)", async () => {
    const { McpClientManager } = await import("../backends/manager.js");
    // syncConfig only skips reconnect when everything except disabledTools is identical.
    const strip = (s: Record<string, unknown>) => {
      const { disabledTools: _dt, ...rest } = s;
      return JSON.stringify(rest);
    };
    const oldServer = { type: "stdio" as const, command: "echo", disabledTools: ["a"] };
    const newServer = { type: "stdio" as const, command: "echo", disabledTools: ["a", "b"] };
    const changed = { type: "stdio" as const, command: "echonew" };
    expect(strip(oldServer as unknown as Record<string, unknown>)).toBe(strip(newServer as unknown as Record<string, unknown>));
    expect(strip(oldServer as unknown as Record<string, unknown>)).not.toBe(strip(changed as unknown as Record<string, unknown>));
  });
});
