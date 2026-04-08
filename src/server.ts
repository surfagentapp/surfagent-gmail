import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { daemonHealth } from "./connection.js";
import { extractVisible, fillComposeDraft, getComposerState, getOpenMessage, getSiteState, openCompose, openSent, openSite, openVisibleThreadRow, sendCurrentCompose } from "./site.js";
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
  {
    name: "gmail_open_compose",
    description: "Open the Gmail compose dialog in the active tab.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } }, additionalProperties: false },
    handler: async (args) => {
      const input = asObject(args, "gmail_open_compose arguments");
      return textResult(JSON.stringify(await openCompose(asOptionalString(input.tabId)), null, 2));
    },
  },
  {
    name: "gmail_get_composer_state",
    description: "Inspect Gmail compose dialog presence, fields, and current draft values.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } }, additionalProperties: false },
    handler: async (args) => {
      const input = asObject(args, "gmail_get_composer_state arguments");
      return textResult(JSON.stringify(await getComposerState(asOptionalString(input.tabId)), null, 2));
    },
  },
  {
    name: "gmail_fill_compose_draft",
    description: "Fill the open Gmail compose draft with to, subject, and plain-text body content.",
    inputSchema: {
      type: "object",
      properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, tabId: { type: "string" } },
      additionalProperties: false,
    },
    handler: async (args) => {
      const input = asObject(args, "gmail_fill_compose_draft arguments");
      return textResult(JSON.stringify(await fillComposeDraft({ to: asOptionalString(input.to), subject: asOptionalString(input.subject), body: asOptionalString(input.body) }, asOptionalString(input.tabId)), null, 2));
    },
  },
  {
    name: "gmail_send_compose",
    description: "Click the active Gmail Send button and return immediate post-send signals.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } }, additionalProperties: false },
    handler: async (args) => {
      const input = asObject(args, "gmail_send_compose arguments");
      return textResult(JSON.stringify(await sendCurrentCompose(asOptionalString(input.tabId)), null, 2));
    },
  },
  {
    name: "gmail_open_sent",
    description: "Open Gmail Sent Mail from the current Gmail tab.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } }, additionalProperties: false },
    handler: async (args) => {
      const input = asObject(args, "gmail_open_sent arguments");
      return textResult(JSON.stringify(await openSent(asOptionalString(input.tabId)), null, 2));
    },
  },
  {
    name: "gmail_open_visible_thread_row",
    description: "Open a visible Gmail thread row by zero-based index from the current mailbox view.",
    inputSchema: { type: "object", properties: { index: { type: "number" }, tabId: { type: "string" } }, additionalProperties: false },
    handler: async (args) => {
      const input = asObject(args, "gmail_open_visible_thread_row arguments");
      return textResult(JSON.stringify(await openVisibleThreadRow(asOptionalNumber(input.index) ?? 0, asOptionalString(input.tabId)), null, 2));
    },
  },
  {
    name: "gmail_get_open_message",
    description: "Inspect the currently opened Gmail message or conversation for proof and extraction.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } }, additionalProperties: false },
    handler: async (args) => {
      const input = asObject(args, "gmail_get_open_message arguments");
      return textResult(JSON.stringify(await getOpenMessage(asOptionalString(input.tabId)), null, 2));
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
