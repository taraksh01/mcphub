import { describe, it, expect, vi } from "vitest";
import { ToolAggregator } from "../tools.js";
import { isSessionError } from "../util.js";
import type { McpClientManager } from "../backends/manager.js";
import type { IBackend, Json, Tool, CallToolResult } from "../types.js";

describe("isSessionError", () => {
  it("detects a 404 (expired/invalid HTTP session)", () => {
    const e = new Error("Error POSTing to endpoint: 404 Not Found") as Error & { code?: number };
    e.code = 404;
    expect(isSessionError(e)).toBe(true);
  });

  it("detects -32000 'Server not initialized'", () => {
    const e = new Error("Server not initialized") as Error & { code?: number };
    e.code = -32000;
    expect(isSessionError(e)).toBe(true);
  });

  it("detects session-terminated messages", () => {
    const e = new Error("session expired, please reconnect");
    expect(isSessionError(e)).toBe(true);
  });

  it("ignores an unrelated -32000 error", () => {
    const e = new Error("some other server error") as Error & { code?: number };
    e.code = -32000;
    expect(isSessionError(e)).toBe(false);
  });

  it("ignores a generic error", () => {
    expect(isSessionError(new Error("boom"))).toBe(false);
  });

  it("ignores non-Error values", () => {
    expect(isSessionError("404 session gone")).toBe(false);
    expect(isSessionError(null)).toBe(false);
  });
});

function sessionError(): Error {
  const e = new Error("Server not initialized") as Error & { code?: number };
  e.code = -32000;
  return e;
}

function makeBackend(
  callToolImpl: (name: string, args: Record<string, Json>) => Promise<CallToolResult>
): { backend: IBackend; reconnect: ReturnType<typeof vi.fn>; getCalls: () => number } {
  let callCount = 0;
  const reconnect = vi.fn(async () => {});
  const backend: IBackend = {
    getName: () => "mock",
    getType: () => "http",
    reconnect,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    getTools: vi.fn(async (): Promise<Tool[]> => []),
    callTool: vi.fn(async (name: string, args: Record<string, Json>): Promise<CallToolResult> => {
      callCount++;
      return callToolImpl(name, args);
    }),
  };
  return { backend, reconnect, getCalls: () => callCount };
}

function makeManager(backend: IBackend): McpClientManager {
  return {
    getBackend: (name: string) => (name === "mock" ? backend : undefined),
    getAllBackends: () => [backend],
  } as unknown as McpClientManager;
}

describe("ToolAggregator session reconnection", () => {
  it("reinitializes the backend and retries the tool call on a -32000 session error", async () => {
    const { backend, reconnect, getCalls } = makeBackend(async () => {
      if (getCalls() === 1) throw sessionError();
      return { content: [{ type: "text", text: "ok" }] } as CallToolResult;
    });
    const agg = new ToolAggregator(makeManager(backend), () => []);
    const result = await agg.callTool("mock:tool", {});
    expect(getCalls()).toBe(2);
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("does not retry on a non-session error", async () => {
    const { backend, reconnect } = makeBackend(async () => {
      throw new Error("boom");
    });
    const agg = new ToolAggregator(makeManager(backend), () => []);
    await expect(agg.callTool("mock:tool", {})).rejects.toThrow("boom");
    expect(reconnect).not.toHaveBeenCalled();
  });

  it("reconnects and retries when listing tools fails with a session error", async () => {
    const reconnect = vi.fn(async () => {});
    let listCount = 0;
    const backend: IBackend = {
      getName: () => "mock",
      getType: () => "http",
      reconnect,
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      getTools: vi.fn(async (): Promise<Tool[]> => {
        listCount++;
        if (listCount === 1) throw sessionError();
        return [{ name: "tool", description: "d", inputSchema: { type: "object", properties: {} } }];
      }),
      callTool: vi.fn(async (): Promise<CallToolResult> => ({ content: [] })),
    };
    const agg = new ToolAggregator(makeManager(backend), () => []);
    const tools = await agg.getAllTools();
    expect(listCount).toBe(2);
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(tools.map((t) => t.name)).toEqual(["mock:tool"]);
  });
});
