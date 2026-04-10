import { TOOL_SET, createServer } from "./server.js";

const expected = [
  "gmail_health_check",
  "gmail_open",
  "gmail_get_state",
  "gmail_open_label",
  "gmail_extract_visible_threads",
  "gmail_open_compose",
  "gmail_get_composer_state",
  "gmail_fill_compose_draft",
  "gmail_send_compose",
  "gmail_open_sent",
  "gmail_open_reply",
  "gmail_open_visible_thread_row",
  "gmail_get_open_message",
  "gmail_compose_and_send_task",
  "gmail_reply_and_send_task",
  "gmail_check_mailbox_task",
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const names = TOOL_SET.map((tool) => tool.name);
const uniqueNames = new Set(names);
const missing = expected.filter((name) => !names.includes(name));

assert(names.length === uniqueNames.size, "Duplicate tool names detected.");
assert(missing.length === 0, `Missing expected tools: ${missing.join(", ")}`);

for (const tool of TOOL_SET) {
  assert(typeof tool.description === "string" && tool.description.trim().length > 0, `Tool ${tool.name} is missing a description.`);
  assert(tool.inputSchema?.type === "object", `Tool ${tool.name} must expose an object input schema.`);
  assert(typeof tool.handler === "function", `Tool ${tool.name} is missing a handler.`);
}

const server = createServer();
assert(!!server, "Failed to create MCP server instance.");

console.log(JSON.stringify({ ok: true, toolCount: names.length, toolNames: names }, null, 2));
