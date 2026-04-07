import { TOOL_SET } from "./server.js";

    const expected = [
  "gmail_health_check",
  "gmail_open",
  "gmail_get_state",
  "gmail_open_label",
  "gmail_extract_visible_threads"
];
    const names = TOOL_SET.map((tool) => tool.name);
    const missing = expected.filter((name) => !names.includes(name));

    if (missing.length > 0) {
      console.error(JSON.stringify({ ok: false, missing, names }, null, 2));
      process.exit(1);
    }

    console.log(JSON.stringify({ ok: true, toolCount: names.length, toolNames: names }, null, 2));
