import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { daemonHealth } from "./connection.js";
import { extractVisible, getSiteState, openSite } from "./site.js";
import type { ToolDefinition } from "./types.js";
import { asObject, asOptionalNumber, asOptionalString, errorResult, textResult } from "./types.js";

export const TOOL_SET: ToolDefinition[] = [
  {
    name: "gmail_health_check",
    description: "Check the SurfAgent daemon and basic Gmail adapter availability.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => textResult(JSON.stringify(await daemonHealth(), null, 2)),
  },
  {
    name: "gmail_open",
    description: "Open Gmail in the SurfAgent managed browser.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
    handler: async (args) => {
      const input = asObject(args, "gmail_open arguments");
      return textResult(JSON.stringify(await openSite(asOptionalString(input.path)), null, 2));
    },
  },
  {
    name: "gmail_get_state",
    description: "Inspect the current Gmail page state.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } }, additionalProperties: false },
    handler: async (args) => {
      const input = asObject(args, "gmail_get_state arguments");
      return textResult(JSON.stringify(await getSiteState(asOptionalString(input.tabId)), null, 2));
    },
  },
  {
    name: "gmail_open_label",
    description: "Open a Gmail label, inbox section, or message URL/path.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
    handler: async (args) => {
      const input = asObject(args, "gmail_open_label arguments");
      return textResult(JSON.stringify(await openSite(asOptionalString(input.path)), null, 2));
    },
  },
  {
    name: "gmail_extract_visible_threads",
    description: "Extract currently visible Gmail thread rows from the active view.",
    inputSchema: { type: "object", properties: { limit: { type: "number" }, tabId: { type: "string" } }, additionalProperties: false },
    handler: async (args) => {
      const input = asObject(args, "gmail_extract_visible_threads arguments");
      return textResult(JSON.stringify(await extractVisible(asOptionalNumber(input.limit) ?? 10, asOptionalString(input.tabId)), null, 2));
    },
  },
];

export function createServer(): Server {
  const server = new Server(
    { name: "surfagent-gmail", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_SET.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOL_SET.find((t) => t.name === request.params.name);
    if (!tool) {
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }] };
    }
    try {
      return await tool.handler(request.params.arguments ?? {});
    } catch (error) {
      return errorResult(error);
    }
  });

  return server;
}
