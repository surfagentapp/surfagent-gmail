import { TOOL_SET } from "./server.js";

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
  "gmail_open_visible_thread_row",
  "gmail_get_open_message",
];
    const names = TOOL_SET.map((tool) => tool.name);
    const missing = expected.filter((name) => !names.includes(name));

    if (missing.length > 0) {
      console.error(JSON.stringify({ ok: false, missing, names }, null, 2));
      process.exit(1);
    }

    console.log(JSON.stringify({ ok: true, toolCount: names.length, toolNames: names }, null, 2));
