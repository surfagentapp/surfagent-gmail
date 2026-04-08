# surfagent-gmail

Gmail adapter for [SurfAgent](https://surfagent.app).

This adapter gives AI agents Gmail-native verbs so they do not have to improvise fragile selectors every time they open compose, inspect mailbox state, or verify a sent message.

## What this adapter is for

Use `surfagent-gmail` when you need reliable Gmail workflows like:
- opening Gmail in the managed browser
- checking mailbox or compose state
- extracting visible thread rows
- opening a visible thread
- inspecting an opened message
- composing a draft
- sending a message
- opening Sent Mail for proof

## Why this exists

Gmail is not a normal form page.

It has:
- dynamic compose surfaces
- editor behavior that can lie to raw DOM pokes
- multiple mailbox states
- send flows where a click is not proof

So this adapter gives site-native tools instead of making agents rediscover Gmail every run.

## Current tool set

- `gmail_health_check`
- `gmail_open`
- `gmail_get_state`
- `gmail_open_label`
- `gmail_extract_visible_threads`
- `gmail_open_visible_thread_row`
- `gmail_get_open_message`
- `gmail_open_compose`
- `gmail_get_composer_state`
- `gmail_fill_compose_draft`
- `gmail_send_compose`
- `gmail_open_sent`

## Proof rule

For Gmail send flows, success is not just clicking Send.

Minimum proof:
1. compose fields contain the intended values
2. send confirmation appears
3. Sent Mail or the opened sent message reflects the result

Practical verification flow:
1. `gmail_open_compose`
2. `gmail_fill_compose_draft`
3. `gmail_get_composer_state`
4. `gmail_send_compose`
5. `gmail_open_sent`
6. `gmail_extract_visible_threads`
7. `gmail_open_visible_thread_row`
8. `gmail_get_open_message`

## How to use it

Run this adapter alongside the base SurfAgent MCP.

Base MCP:
```json
{
  "mcpServers": {
    "surfagent": {
      "command": "npx",
      "args": ["-y", "surfagent-mcp"]
    },
    "surfagent-gmail": {
      "command": "npx",
      "args": ["-y", "surfagent-gmail"]
    }
  }
}
```

If you are new to SurfAgent, start here first:
- <https://github.com/surfagentapp/surfagent-docs/blob/main/docs/start-here.md>
- <https://github.com/surfagentapp/surfagent-docs/blob/main/docs/mcp-server.md>
- <https://github.com/surfagentapp/surfagent-docs/blob/main/docs/skills-and-adapters.md>

## When to use this vs skills vs raw MCP

- use `surfagent-mcp` for generic browser control
- use `surfagent-skills` for better execution rules and reusable workflows
- use `surfagent-gmail` when you want Gmail-native verbs and proof-aware send flows

## Notes and limits

- body writing is plain text only for now
- visible thread extraction is navigation-focused, not full mailbox sync
- opened-message extraction is proof-oriented, not a Gmail API replacement

## Related repos

- [surfagent](https://github.com/surfagentapp/surfagent)
- [surfagent-mcp](https://github.com/surfagentapp/surfagent/tree/main/surfagent-mcp)
- [surfagent-docs](https://github.com/surfagentapp/surfagent-docs)
- [surfagent-skills](https://github.com/surfagentapp/surfagent-skills)

## Status

Experimental, but materially useful.

## License

MIT
