import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { daemonHealth } from "./connection.js";
import { extractVisible, fillComposeDraft, getComposerState, getOpenMessage, getSiteState, openCompose, openReply, openSent, openSite, openVisibleThreadRow, sendCurrentCompose } from "./site.js";
import { runCheckMailboxTask, runComposeAndSendTask, runOpenLatestThreadTask, runReplyAndSendTask, runTriageMailboxTask } from "./task-runner.js";
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
    name: "gmail_open_reply",
    description: "Open the inline Gmail reply composer in the currently opened message thread.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } }, additionalProperties: false },
    handler: async (args) => {
      const input = asObject(args, "gmail_open_reply arguments");
      return textResult(JSON.stringify(await openReply(asOptionalString(input.tabId)), null, 2));
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
  {
    name: "gmail_compose_and_send_task",
    description: "Run a deterministic Gmail compose-and-send task with screenshots, draft verification, and optional sent-mail verification.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        send: { type: "boolean", description: "Actually send the email. Defaults to true." },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const input = asObject(args, "gmail_compose_and_send_task arguments");
      const to = String(input.to ?? "").trim();
      const subject = String(input.subject ?? "").trim();
      const body = String(input.body ?? "").trim();
      return textResult(JSON.stringify(await runComposeAndSendTask({ to, subject, body, send: input.send === false ? false : true }), null, 2));
    },
  },
  {
    name: "gmail_reply_and_send_task",
    description: "Run a deterministic Gmail reply task with thread-open, reply-open, screenshots, draft verification, and optional send verification.",
    inputSchema: {
      type: "object",
      properties: {
        body: { type: "string" },
        threadIndex: { type: "number", description: "Zero-based inbox row index to open before replying. Defaults to 0." },
        send: { type: "boolean", description: "Actually send the reply. Defaults to true." },
      },
      required: ["body"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const input = asObject(args, "gmail_reply_and_send_task arguments");
      const body = String(input.body ?? "").trim();
      return textResult(JSON.stringify(await runReplyAndSendTask({ body, ...(typeof input.threadIndex === "number" ? { threadIndex: input.threadIndex } : {}), send: input.send === false ? false : true }), null, 2));
    },
  },
  {
    name: "gmail_check_mailbox_task",
    description: "Run a deterministic Gmail mailbox check for inbox, spam, sent, drafts, or outbox-style sent view with screenshots and visible-thread extraction.",
    inputSchema: {
      type: "object",
      properties: {
        mailbox: { type: "string", enum: ["inbox", "spam", "sent", "drafts", "outbox"] },
        limit: { type: "number", description: "Visible thread rows to extract. Defaults to 10." },
      },
      required: ["mailbox"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const input = asObject(args, "gmail_check_mailbox_task arguments");
      const mailbox = String(input.mailbox ?? "").trim().toLowerCase() as "inbox" | "spam" | "sent" | "drafts" | "outbox";
      return textResult(JSON.stringify(await runCheckMailboxTask({ mailbox, ...(typeof input.limit === "number" ? { limit: input.limit } : {}) }), null, 2));
    },
  },
  {
    name: "gmail_open_latest_thread_task",
    description: "Run a deterministic Gmail thread-open task that opens a mailbox, opens a visible thread row, and captures the resulting message with proof artifacts.",
    inputSchema: {
      type: "object",
      properties: {
        mailbox: { type: "string", enum: ["inbox", "spam", "sent", "drafts", "outbox"], description: "Mailbox to open before selecting a thread. Defaults to inbox." },
        threadIndex: { type: "number", description: "Zero-based visible thread row index. Defaults to 0." },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const input = asObject(args, "gmail_open_latest_thread_task arguments");
      return textResult(JSON.stringify(await runOpenLatestThreadTask({
        ...(typeof input.mailbox === "string" ? { mailbox: String(input.mailbox).trim().toLowerCase() as "inbox" | "spam" | "sent" | "drafts" | "outbox" } : {}),
        ...(typeof input.threadIndex === "number" ? { threadIndex: input.threadIndex } : {}),
      }), null, 2));
    },
  },
  {
    name: "gmail_triage_mailbox_task",
    description: "Run a deterministic Gmail mailbox triage task that scores visible threads, summarizes urgency, and can optionally open the best candidate.",
    inputSchema: {
      type: "object",
      properties: {
        mailbox: { type: "string", enum: ["inbox", "spam", "sent", "drafts", "outbox"], description: "Mailbox to triage. Defaults to inbox." },
        limit: { type: "number", description: "Visible thread rows to score. Defaults to 10." },
        openBestCandidate: { type: "boolean", description: "Open the highest-scoring visible thread and capture proof artifacts." }
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const input = asObject(args, "gmail_triage_mailbox_task arguments");
      return textResult(JSON.stringify(await runTriageMailboxTask({
        ...(typeof input.mailbox === "string" ? { mailbox: String(input.mailbox).trim().toLowerCase() as "inbox" | "spam" | "sent" | "drafts" | "outbox" } : {}),
        ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        ...(typeof input.openBestCandidate === "boolean" ? { openBestCandidate: input.openBestCandidate } : {}),
      }), null, 2));
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
