# Gmail adapter for SurfAgent

Experimental SurfAgent MCP adapter for Gmail.

## Current scope
- health check against the SurfAgent daemon
- open Gmail in the managed browser
- inspect Gmail page state
- extract visible thread rows
- open a visible thread row
- inspect an opened message/conversation
- open the compose dialog
- inspect compose state
- fill an open draft
- send the current draft
- open Sent Mail

## Why this exists
Gmail is not a generic form page.

It has:
- dynamic compose surfaces
- React-like editor behavior
- multiple mailbox states
- verification requirements where a click is not proof

This adapter gives Gmail-native verbs so agents stop guessing at raw selectors every run.

## Tool set
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
For send flows, success is not just "the button was clicked".

Minimum proof:
1. compose fields contain the intended values
2. send confirmation appears
3. Sent Mail or the opened sent message reflects the result

Practical verification flow with the current tool set:
1. `gmail_open_compose`
2. `gmail_fill_compose_draft`
3. `gmail_get_composer_state`
4. `gmail_send_compose`
5. `gmail_open_sent`
6. `gmail_extract_visible_threads`
7. `gmail_open_visible_thread_row`
8. `gmail_get_open_message`

## Notes and limits
- body writing is plain text only for now
- visible thread extraction is intentionally lightweight, it is for navigation and proof, not full mailbox sync
- opened-message extraction returns the visible conversation text/preview, which is enough for proof but not a structured Gmail API replacement

## Next scope
- reply and forward flows
- richer sent-message parsing once field stability is proven
- label navigation helpers
- receipts and persistence once the surface is proven stable
