import { McpClientManager } from "./backends/manager.js";

export interface NamespacedTool {
  name: string;
  originalName: string;
  backend: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const TOOL_CACHE_TTL_MS = 30_000;

export class ToolAggregator {
  private cache = new Map<string, { backend: unknown; tools: NamespacedTool[]; fetchedAt: number }>();

  constructor(
    private manager: McpClientManager,
    private getDisabledTools: (backend: string) => string[]
  ) {}

  async getAllTools(includeDisabled = false): Promise<NamespacedTool[]> {
    const tools: NamespacedTool[] = [];
    const backends = this.manager.getAllBackends();
    const liveNames = new Set(backends.map((b) => b.getName()));
    for (const key of this.cache.keys()) {
      if (!liveNames.has(key)) this.cache.delete(key);
    }
    const disabled = (name: string) => new Set(this.getDisabledTools(name));

    for (const backend of backends) {
      const name = backend.getName();
      const cached = this.cache.get(name);
      if (cached && cached.backend === backend && Date.now() - cached.fetchedAt < TOOL_CACHE_TTL_MS) {
        const filtered = includeDisabled ? cached.tools : cached.tools.filter((t) => !disabled(name).has(t.originalName));
        tools.push(...filtered);
        continue;
      }
      try {
        const backendTools = await backend.getTools();
        const namespaced = backendTools.map((tool) => ({
          name: `${name}:${tool.name}`,
          originalName: tool.name,
          backend: name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
        this.cache.set(name, { backend, tools: namespaced, fetchedAt: Date.now() });
        const filtered = includeDisabled ? namespaced : namespaced.filter((t) => !disabled(name).has(t.originalName));
        tools.push(...filtered);
      } catch (e) {
        console.error(`Failed to list tools for "${name}":`, e);
      }
    }

    return tools;
  }

  async callTool(
    namespacedName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const colonIndex = namespacedName.indexOf(":");
    if (colonIndex === -1) {
      throw new Error(
        `Invalid tool name "${namespacedName}". Expected format: "backendName:toolName"`
      );
    }

    const backendName = namespacedName.slice(0, colonIndex);
    const toolName = namespacedName.slice(colonIndex + 1);

    const backend = this.manager.getBackend(backendName);
    if (!backend) {
      throw new Error(`Backend "${backendName}" not connected`);
    }
    if (this.getDisabledTools(backendName).includes(toolName)) {
      throw new Error(`Tool "${toolName}" is disabled on backend "${backendName}"`);
    }

    return backend.callTool(toolName, args);
  }
}
