import { McpClientManager } from "./backends/manager.js";

export interface NamespacedTool {
  name: string;
  originalName: string;
  backend: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export class ToolAggregator {
  constructor(private manager: McpClientManager) {}

  async getAllTools(): Promise<NamespacedTool[]> {
    const tools: NamespacedTool[] = [];
    const backends = this.manager.getAllBackends();

    for (const backend of backends) {
      try {
        const backendTools = await backend.getTools();
        for (const tool of backendTools) {
          tools.push({
            name: `${backend.getName()}:${tool.name}`,
            originalName: tool.name,
            backend: backend.getName(),
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        }
      } catch (e) {
        console.error(`Failed to list tools for "${backend.getName()}":`, e);
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

    return backend.callTool(toolName, args);
  }
}
