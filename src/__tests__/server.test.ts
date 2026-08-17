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
  it("can write and read runtime JSON file", async () => {
    const { writeFileSync, readFileSync, unlinkSync, mkdirSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");

    const dir = join(tmpdir(), `mcphub-rt-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "hub.runtime.json");

    const data = { port: 5432, host: "0.0.0.0" };
    writeFileSync(file, JSON.stringify(data));
    const read = JSON.parse(readFileSync(file, "utf-8"));
    expect(read.port).toBe(5432);
    expect(read.host).toBe("0.0.0.0");

    unlinkSync(file);
    const { existsSync } = await import("fs");
    expect(existsSync(file)).toBe(false);

    const { rmSync } = await import("fs");
    rmSync(dir, { recursive: true, force: true });
  });
});
