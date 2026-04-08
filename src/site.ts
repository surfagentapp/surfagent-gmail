import { ensureSiteTab, evaluate } from "./connection.js";

export async function openSite(path?: string) {
  return ensureSiteTab(path || "/mail/u/0/#inbox");
}

export async function getSiteState(tabId?: string) {
  const raw = await evaluate<string>(String.raw`(() => {
    const url = location.href;
    const path = location.pathname + location.hash;
    const title = document.title || null;
    const mainPresent = !!document.querySelector('main, [role="main"]');
    const selectedMailbox = document.querySelector('[role="navigation"] [aria-current="page"]')?.textContent?.trim() || null;
    const visibleSubject = document.querySelector('h2, h1')?.textContent?.trim() || null;
    const composeButton = document.querySelector('div[role="button"][gh="cm"]');
    const composeDialog = document.querySelector('div[role="dialog"]');
    const toField = document.querySelector('input[aria-label*="To recipients"], input[aria-label="Recipients"]') as HTMLInputElement | null;
    const subjectField = document.querySelector('input[name="subjectbox"]') as HTMLInputElement | null;
    const bodyField = document.querySelector('div[aria-label="Message Body"], div[g_editable="true"][role="textbox"]') as HTMLElement | null;
    const sendButton = document.querySelector('div[role="button"][data-tooltip^="Send"], div[role="button"][aria-label^="Send"]');

    return JSON.stringify({
      ok: true,
      site: 'Gmail',
      url,
      path,
      title,
      mainPresent,
      selectedMailbox,
      visibleSubject,
      composeFound: !!composeButton,
      composeDialogOpen: !!composeDialog,
      sendButtonPresent: !!sendButton,
      composer: {
        to: toField?.value || null,
        subject: subjectField?.value || null,
        bodyText: bodyField?.innerText?.trim() || null,
      },
    });
  })();`, tabId);
  return parseJsonResult(raw);
}

export async function openCompose(tabId?: string) {
  const raw = await evaluate<string>(String.raw`(() => {
    const button = document.querySelector('div[role="button"][gh="cm"]') as HTMLElement | null;
    if (!button) {
      return JSON.stringify({ ok: false, error: 'Compose button not found.' });
    }
    button.click();
    const dialogOpen = !!document.querySelector('div[role="dialog"]');
    return JSON.stringify({ ok: true, clicked: true, dialogOpen });
  })();`, tabId);
  return parseJsonResult(raw);
}

export async function getComposerState(tabId?: string) {
  const raw = await evaluate<string>(String.raw`(() => {
    const dialog = document.querySelector('div[role="dialog"]');
    const toField = document.querySelector('input[aria-label*="To recipients"], input[aria-label="Recipients"]') as HTMLInputElement | null;
    const subjectField = document.querySelector('input[name="subjectbox"]') as HTMLInputElement | null;
    const bodyField = document.querySelector('div[aria-label="Message Body"], div[g_editable="true"][role="textbox"]') as HTMLElement | null;
    const sendButton = document.querySelector('div[role="button"][data-tooltip^="Send"], div[role="button"][aria-label^="Send"]') as HTMLElement | null;
    return JSON.stringify({
      ok: true,
      dialogOpen: !!dialog,
      fieldsPresent: {
        to: !!toField,
        subject: !!subjectField,
        body: !!bodyField,
      },
      values: {
        to: toField?.value || null,
        subject: subjectField?.value || null,
        bodyText: bodyField?.innerText?.trim() || null,
      },
      sendButtonPresent: !!sendButton,
      sendButtonText: sendButton?.textContent?.trim() || null,
    });
  })();`, tabId);
  return parseJsonResult(raw);
}

export async function fillComposeDraft(input: { to?: string; subject?: string; body?: string }, tabId?: string) {
  const payload = JSON.stringify(input);
  const raw = await evaluate<string>(String.raw`(() => {
    const input = ${payload};
    const result = { ok: true, wrote: { to: false, subject: false, body: false } };

    const toField = document.querySelector('input[aria-label*="To recipients"], input[aria-label="Recipients"]') as HTMLInputElement | null;
    const subjectField = document.querySelector('input[name="subjectbox"]') as HTMLInputElement | null;
    const bodyField = document.querySelector('div[aria-label="Message Body"], div[g_editable="true"][role="textbox"]') as HTMLElement | null;

    const setInputValue = (el: HTMLInputElement, value: string) => {
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    };

    if (typeof input.to === 'string' && toField) {
      setInputValue(toField, input.to);
      result.wrote.to = true;
    }
    if (typeof input.subject === 'string' && subjectField) {
      setInputValue(subjectField, input.subject);
      result.wrote.subject = true;
    }
    if (typeof input.body === 'string' && bodyField) {
      bodyField.focus();
      bodyField.innerText = input.body;
      bodyField.dispatchEvent(new InputEvent('input', { bubbles: true, data: input.body, inputType: 'insertText' }));
      result.wrote.body = true;
    }

    return JSON.stringify({
      ...result,
      values: {
        to: toField?.value || null,
        subject: subjectField?.value || null,
        bodyText: bodyField?.innerText?.trim() || null,
      }
    });
  })();`, tabId);
  return parseJsonResult(raw);
}

export async function sendCurrentCompose(tabId?: string) {
  const raw = await evaluate<string>(String.raw`(() => {
    const sendButton = document.querySelector('div[role="button"][data-tooltip^="Send"], div[role="button"][aria-label^="Send"]') as HTMLElement | null;
    if (!sendButton) {
      return JSON.stringify({ ok: false, error: 'Send button not found.' });
    }
    sendButton.click();
    const alertText = Array.from(document.querySelectorAll('[role="alert"], [aria-live]'))
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean)
      .join(' | ');
    const composeDialogOpen = !!document.querySelector('div[role="dialog"]');
    return JSON.stringify({
      ok: true,
      clicked: true,
      composeDialogOpen,
      alertText,
      sentHit: /message sent/i.test(alertText),
      undoHit: /undo/i.test(alertText),
    });
  })();`, tabId);
  return parseJsonResult(raw);
}

export async function openSent(tabId?: string) {
  const raw = await evaluate<string>(String.raw`(() => {
    const sentLink = Array.from(document.querySelectorAll('[role="navigation"] a, [role="navigation"] [role="link"]'))
      .find((el) => /sent/i.test((el.textContent || '').trim())) as HTMLElement | undefined;
    if (!sentLink) {
      return JSON.stringify({ ok: false, error: 'Sent link not found.' });
    }
    sentLink.click();
    return JSON.stringify({ ok: true, clicked: true, title: document.title || null, url: location.href });
  })();`, tabId);
  return parseJsonResult(raw);
}

export async function openVisibleThreadRow(index = 0, tabId?: string) {
  const payload = JSON.stringify({ index });
  const raw = await evaluate<string>(String.raw`(() => {
    const input = ${payload};
    const rows = [...document.querySelectorAll('tr[role="row"]')]
      .map((row, rowIndex) => ({ row, rowIndex, text: (row.innerText || row.textContent || '').trim() }))
      .filter((item) => item.text);
    const target = rows[input.index];
    if (!target) {
      return JSON.stringify({ ok: false, error: 'Visible thread row not found.', availableRows: rows.length });
    }

    const clickable = target.row.querySelector('span[role="link"], div[role="link"], a, td') as HTMLElement | null;
    const clickTarget = clickable ?? target.row;
    clickTarget.click();

    return JSON.stringify({
      ok: true,
      clicked: true,
      index: input.index,
      text: target.text,
      title: document.title || null,
      url: location.href,
    });
  })();`, tabId);
  return parseJsonResult(raw);
}

export async function getOpenMessage(tabId?: string) {
  const raw = await evaluate<string>(String.raw`(() => {
    const subject = document.querySelector('h2, h1')?.textContent?.trim() || null;
    const conversation = document.querySelector('[role="main"]') as HTMLElement | null;
    const messageEls = [...document.querySelectorAll('[role="listitem"], .adn, .gs')]
      .filter((el) => (el.textContent || '').trim());
    const latestMessage = (messageEls[messageEls.length - 1] as HTMLElement | undefined) ?? null;
    const participants = [...document.querySelectorAll('span[email], [data-hovercard-id], .gD')]
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 10);
    const bodyText = latestMessage?.innerText?.trim() || conversation?.innerText?.trim() || null;

    return JSON.stringify({
      ok: true,
      url: location.href,
      title: document.title || null,
      subject,
      participants,
      messageCount: messageEls.length,
      bodyText,
      bodyPreview: bodyText ? bodyText.slice(0, 1000) : null,
    });
  })();`, tabId);
  return parseJsonResult(raw);
}

export async function extractVisible(limit = 10, tabId?: string) {
  const raw = await evaluate<string>(String.raw`(() => {
    const diagnostics = {
      url: location.href,
      path: location.pathname + location.hash,
      title: document.title || null,
      mainPresent: !!document.querySelector('main, [role="main"]'),
    };
    const rows = [...document.querySelectorAll('tr[role="row"]')]
      .map((el, index) => ({
        index,
        text: (el.innerText || el.textContent || '').trim(),
      }))
      .filter((item) => item.text)
      .slice(0, limit);
    return JSON.stringify({ ok: true, count: rows.length, items: rows, diagnostics });
  })();`, tabId);
  return parseJsonResult(raw);
}

function parseJsonResult(raw: unknown) {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  }
  return raw;
}
