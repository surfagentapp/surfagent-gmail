import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSiteTabByPath, screenshot } from "./connection.js";
import { extractVisible, fillComposeDraft, getComposerState, getOpenMessage, getSiteState, openCompose, openReply, openSent, openSite, openVisibleThreadRow, sendCurrentCompose } from "./site.js";
import { createTaskRunnerRuntime, type ScreenshotArtifact, type TaskRunBase, type TaskStep } from "./task-runner-runtime.js";

export type GmailTaskKind = "compose-and-send" | "reply-and-send" | "check-mailbox" | "open-latest-thread" | "triage-mailbox";

export type GmailTaskRun = TaskRunBase & {
  adapter: "gmail";
  task: GmailTaskKind;
  steps: TaskStep[];
  artifacts: ScreenshotArtifact[];
  outcome?: unknown;
  error?: { code: string; message: string; retryable?: boolean };
};

export type ComposeAndSendOptions = {
  to: string;
  subject: string;
  body: string;
  send?: boolean;
};

export type ReplyAndSendOptions = {
  body: string;
  threadIndex?: number;
  send?: boolean;
};

export type CheckMailboxOptions = {
  mailbox: "inbox" | "spam" | "sent" | "drafts" | "outbox";
  limit?: number;
};

export type OpenLatestThreadOptions = {
  mailbox?: "inbox" | "spam" | "sent" | "drafts" | "outbox";
  threadIndex?: number;
};

export type TriageMailboxOptions = {
  mailbox?: "inbox" | "spam" | "sent" | "drafts" | "outbox";
  limit?: number;
  openBestCandidate?: boolean;
};

const RUN_ROOT = process.env.SURFAGENT_RUN_DIR || join(tmpdir(), "surfagent-gmail-runs");

const runtime = createTaskRunnerRuntime({
  rootDir: RUN_ROOT,
  screenshot,
});

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'run';
}

function makeRunId(task: string): string {
  return runtime.makeRunId(task);
}

async function overwriteRunManifest(run: GmailTaskRun): Promise<string> {
  return runtime.writeRunManifest(run);
}

async function captureRunScreenshot(run: GmailTaskRun, tabId: string | undefined, label: string): Promise<ScreenshotArtifact | null> {
  return runtime.captureScreenshot(run, tabId, label);
}

async function withStep<T>(run: GmailTaskRun, name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await runtime.withStep(run, name, fn);
  } catch (error) {
    run.ok = false;
    run.error = {
      code: inferErrorCode(error),
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
    await overwriteRunManifest(run);
    throw error;
  }
}

function inferErrorCode(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/compose/i.test(text)) return "compose_open_failed";
  if (/send/i.test(text)) return "send_failed";
  if (/mailbox|inbox|spam|sent|drafts/i.test(text)) return "mailbox_check_failed";
  if (/visible/i.test(text) || /verify/i.test(text)) return "verification_failed";
  return "task_failed";
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 12000, pollMs = 400): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition.`);
}

async function waitForComposeDialog(tabId?: string): Promise<void> {
  await waitFor(async () => {
    const state = await getComposerState(tabId);
    return state.fieldsPresent?.body === true && state.sendButtonPresent === true;
  }, 15000, 500);
}

async function verifyDraft(tabId: string | undefined, options: ComposeAndSendOptions) {
  const state = await getComposerState(tabId);
  const bodyText = String(state.values?.bodyText ?? "").trim();
  const subject = String(state.values?.subject ?? "").trim();
  const to = String(state.values?.to ?? "").trim();
  const bodyNeedle = options.body.trim().slice(0, 80);
  return {
    ok: Boolean(state.dialogOpen && to.includes(options.to) && subject === options.subject && bodyText.includes(bodyNeedle)),
    state,
  };
}

async function verifySent(tabId: string | undefined, options: ComposeAndSendOptions) {
  await openSent(tabId);
  await waitFor(async () => {
    const state = await getSiteState(tabId);
    return /sent/i.test(String(state.selectedMailbox ?? "")) || /#sent/i.test(String(state.path ?? ""));
  }, 15000, 500);
  const visible = await extractVisible(10, tabId);
  const subjectNeedle = options.subject.trim();
  const items = Array.isArray((visible as { items?: unknown[] }).items) ? ((visible as { items?: Array<{ text?: string }> }).items ?? []) : [];
  return {
    visible,
    matched: items.some((item) => String(item.text ?? "").includes(subjectNeedle)),
  };
}

function resolveMailboxPath(mailbox: CheckMailboxOptions["mailbox"]): string {
  switch (mailbox) {
    case "inbox":
      return "/mail/u/0/#inbox";
    case "spam":
      return "/mail/u/0/#spam";
    case "sent":
    case "outbox":
      return "/mail/u/0/#sent";
    case "drafts":
      return "/mail/u/0/#drafts";
    default:
      return "/mail/u/0/#inbox";
  }
}

async function settleMailboxTab(preferredTabId: string | undefined, mailbox: CheckMailboxOptions["mailbox"]) {
  const path = resolveMailboxPath(mailbox).toLowerCase();
  const matched = await findSiteTabByPath(path.replace("https://mail.google.com", ""));
  return matched?.id ?? preferredTabId;
}

async function verifyMailboxOpen(tabId: string | undefined, mailbox: CheckMailboxOptions["mailbox"]) {
  const state = await getSiteState(tabId);
  const path = String(state.path ?? "").toLowerCase();
  const selected = String(state.selectedMailbox ?? "").toLowerCase();
  const normalized = mailbox === "outbox" ? "sent" : mailbox;
  const matched = path.includes(`#${normalized}`) || selected.includes(normalized);
  const hydrated = Boolean(state.mainPresent) && (Number(state.visibleRows ?? 0) > 0 || Boolean(state.composeFound) || /gmail/i.test(String(state.title ?? "")));
  return { state, matched, hydrated };
}

async function waitForMailboxReady(tabId: string | undefined, mailbox: CheckMailboxOptions["mailbox"], requireRows = false) {
  await waitFor(async () => {
    const checked = await verifyMailboxOpen(tabId, mailbox);
    if (!checked.matched || !checked.hydrated) return false;
    if (!requireRows) return true;
    const visible = await extractVisible(5, tabId);
    return Number((visible as { count?: number }).count ?? 0) > 0;
  }, 15000, 500);
  return verifyMailboxOpen(tabId, mailbox);
}

function classifyThreadText(text: string) {
  const lower = text.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  if (/(urgent|asap|immediately|today|deadline|overdue|action required)/i.test(lower)) add(5, "urgency language");
  if (/(security|login|verify|verification|password|recovery|alert|suspicious|new device)/i.test(lower)) add(5, "security/account signal");
  if (/(invoice|payment|failed|receipt|billing|charge|subscription|renewal)/i.test(lower)) add(4, "money/billing signal");
  if (/(reply|respond|review|approve|confirm|confirm your|please read|required)/i.test(lower)) add(3, "explicit action cue");
  if (/(github|x|google|discord|telegram|tradingview|xai)/i.test(lower)) add(1, "important service/vendor mention");
  if (/(newsletter|digest|promo|promotion|sale|deals|marketing)/i.test(lower)) add(-3, "likely promotional");

  const bucket = score >= 7 ? "urgent" : score >= 4 ? "needs_attention" : score >= 1 ? "review" : "low_signal";
  return { score, bucket, reasons };
}

function buildTriage(items: Array<{ index?: number; text?: string }>) {
  const triaged = items.map((item, idx) => {
    const text = String(item.text ?? "").trim();
    const classification = classifyThreadText(text);
    return {
      index: typeof item.index === "number" ? item.index : idx,
      text,
      preview: text.slice(0, 240),
      ...classification,
    };
  });

  const ordered = [...triaged].sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    ordered,
    summary: {
      total: triaged.length,
      urgent: triaged.filter((item) => item.bucket === "urgent").length,
      needsAttention: triaged.filter((item) => item.bucket === "needs_attention").length,
      review: triaged.filter((item) => item.bucket === "review").length,
      lowSignal: triaged.filter((item) => item.bucket === "low_signal").length,
      bestCandidate: ordered[0] ?? null,
    },
  };
}

export async function runCheckMailboxTask(options: CheckMailboxOptions): Promise<GmailTaskRun> {
  const mailbox = options.mailbox;
  const run: GmailTaskRun = {
    ok: true,
    adapter: "gmail",
    task: "check-mailbox",
    runId: makeRunId(`${mailbox}-check-mailbox`),
    steps: [],
    artifacts: [],
  };

  try {
    const opened = await withStep(run, "open-mailbox", async () => {
      const result = await openSite(resolveMailboxPath(mailbox));
      let mailboxTabId: string | undefined = result.id;
      await waitFor(async () => {
        mailboxTabId = (await settleMailboxTab(result.id, mailbox)) ?? result.id;
        const checked = await verifyMailboxOpen(mailboxTabId, mailbox);
        return checked.matched && checked.hydrated;
      }, 15000, 500);
      await captureRunScreenshot(run, mailboxTabId, `${mailbox}-mailbox-open`);
      return { ...result, id: mailboxTabId };
    });

    const mailboxVerified = await withStep(run, "verify-mailbox", async () => {
      const result = await verifyMailboxOpen(opened.id, mailbox);
      if (!result.matched || !result.hydrated) throw new Error(`Mailbox verification failed. Diagnostics: ${JSON.stringify(result.state)}`);
      return result;
    });

    const visibleThreads = await withStep(run, "extract-visible-threads", async () => {
      await waitForMailboxReady(opened.id, mailbox, mailbox === "inbox");
      const result = await extractVisible(options.limit ?? 10, opened.id);
      await captureRunScreenshot(run, opened.id, `${mailbox}-visible-threads`);
      return result;
    });

    run.outcome = { opened, mailboxVerified, visibleThreads };
    await overwriteRunManifest(run);
    return run;
  } catch (error) {
    run.ok = false;
    if (!run.error) {
      run.error = {
        code: inferErrorCode(error),
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }
    await overwriteRunManifest(run);
    throw error;
  }
}

export async function runTriageMailboxTask(options: TriageMailboxOptions): Promise<GmailTaskRun> {
  const mailbox = options.mailbox ?? "inbox";
  const limit = options.limit ?? 10;
  const run: GmailTaskRun = {
    ok: true,
    adapter: "gmail",
    task: "triage-mailbox",
    runId: makeRunId(`${mailbox}-triage-mailbox`),
    steps: [],
    artifacts: [],
  };

  try {
    const opened = await withStep(run, "open-mailbox", async () => {
      const result = await openSite(resolveMailboxPath(mailbox));
      let mailboxTabId: string | undefined = result.id;
      await waitFor(async () => {
        mailboxTabId = (await settleMailboxTab(result.id, mailbox)) ?? result.id;
        const checked = await verifyMailboxOpen(mailboxTabId, mailbox);
        return checked.matched && checked.hydrated;
      }, 15000, 500);
      await captureRunScreenshot(run, mailboxTabId, `${mailbox}-triage-mailbox-open`);
      return { ...result, id: mailboxTabId };
    });

    const mailboxVerified = await withStep(run, "verify-mailbox", async () => {
      const result = await verifyMailboxOpen(opened.id, mailbox);
      if (!result.matched || !result.hydrated) throw new Error(`Mailbox verification failed. Diagnostics: ${JSON.stringify(result.state)}`);
      return result;
    });

    const visibleThreads = await withStep(run, "extract-visible-threads", async () => {
      await waitForMailboxReady(opened.id, mailbox, mailbox === "inbox");
      const result = await extractVisible(limit, opened.id);
      await captureRunScreenshot(run, opened.id, `${mailbox}-triage-visible-threads`);
      return result;
    });

    const triage = await withStep(run, "triage-visible-threads", async () => {
      const items = Array.isArray((visibleThreads as { items?: unknown[] }).items)
        ? ((visibleThreads as { items?: Array<{ index?: number; text?: string }> }).items ?? [])
        : [];
      return buildTriage(items);
    });

    let bestCandidate: unknown = { skipped: true };
    if (options.openBestCandidate === true && triage.summary.bestCandidate && typeof triage.summary.bestCandidate.index === "number") {
      bestCandidate = await withStep(run, "open-best-candidate", async () => {
        const thread = await openVisibleThreadRow(triage.summary.bestCandidate.index, opened.id);
        await captureRunScreenshot(run, opened.id, `${mailbox}-triage-best-candidate-open`);
        const message = await getOpenMessage(opened.id);
        await captureRunScreenshot(run, opened.id, `${mailbox}-triage-best-candidate-message`);
        return { thread, message };
      });
    }

    run.outcome = { opened, mailboxVerified, visibleThreads, triage, bestCandidate };
    await overwriteRunManifest(run);
    return run;
  } catch (error) {
    run.ok = false;
    if (!run.error) {
      run.error = {
        code: inferErrorCode(error),
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }
    await overwriteRunManifest(run);
    throw error;
  }
}

export async function runOpenLatestThreadTask(options: OpenLatestThreadOptions): Promise<GmailTaskRun> {
  const mailbox = options.mailbox ?? "inbox";
  const threadIndex = options.threadIndex ?? 0;
  const run: GmailTaskRun = {
    ok: true,
    adapter: "gmail",
    task: "open-latest-thread",
    runId: makeRunId(`${mailbox}-open-latest-thread`),
    steps: [],
    artifacts: [],
  };

  try {
    const opened = await withStep(run, "open-mailbox", async () => {
      const result = await openSite(resolveMailboxPath(mailbox));
      await waitFor(async () => {
        const checked = await verifyMailboxOpen(result.id, mailbox);
        return checked.matched && checked.hydrated;
      }, 15000, 500);
      await waitForMailboxReady(result.id, mailbox, mailbox === "inbox");
      await captureRunScreenshot(run, result.id, `${mailbox}-thread-mailbox-open`);
      return result;
    });

    const thread = await withStep(run, "open-thread", async () => {
      const result = await openVisibleThreadRow(threadIndex, opened.id);
      await captureRunScreenshot(run, opened.id, `${mailbox}-thread-open`);
      return result;
    });

    const message = await withStep(run, "extract-open-message", async () => {
      await waitFor(async () => {
        const openedMessage = await getOpenMessage(opened.id);
        return Boolean(String(openedMessage.subject ?? "").trim() || String(openedMessage.bodyText ?? "").trim());
      }, 15000, 500);
      const result = await getOpenMessage(opened.id);
      await captureRunScreenshot(run, opened.id, `${mailbox}-thread-message`);
      return result;
    });

    run.outcome = { opened, thread, message };
    await overwriteRunManifest(run);
    return run;
  } catch (error) {
    run.ok = false;
    if (!run.error) {
      run.error = {
        code: inferErrorCode(error),
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }
    await overwriteRunManifest(run);
    throw error;
  }
}

export async function runComposeAndSendTask(options: ComposeAndSendOptions): Promise<GmailTaskRun> {
  const run: GmailTaskRun = {
    ok: true,
    adapter: "gmail",
    task: "compose-and-send",
    runId: makeRunId(`${slug(options.subject)}-compose-and-send`),
    steps: [],
    artifacts: [],
  };

  try {
    const opened = await withStep(run, "open-gmail", async () => openSite("/mail/u/0/#inbox"));
    await withStep(run, "open-compose", async () => {
      const result = await openCompose(opened.id);
      await waitForComposeDialog(opened.id);
      await captureRunScreenshot(run, opened.id, "compose-open");
      return result;
    });

    const filled = await withStep(run, "fill-draft", async () => {
      const result = await fillComposeDraft({ to: options.to, subject: options.subject, body: options.body }, opened.id);
      await captureRunScreenshot(run, opened.id, "draft-filled");
      return result;
    });

    const draftVerified = await withStep(run, "verify-draft", async () => {
      const result = await verifyDraft(opened.id, options);
      if (!result.ok) throw new Error(`Draft verification failed. Diagnostics: ${JSON.stringify(result.state)}`);
      return result;
    });

    let sendResult: unknown = { skipped: true };
    let sentVerified: unknown = { skipped: true };
    if (options.send !== false) {
      sendResult = await withStep(run, "send", async () => {
        await captureRunScreenshot(run, opened.id, "before-send");
        const result = await sendCurrentCompose(opened.id);
        await captureRunScreenshot(run, opened.id, "after-send");
        if ((result as { ok?: boolean }).ok !== true) throw new Error(`Send failed. Diagnostics: ${JSON.stringify(result)}`);
        return result;
      });

      sentVerified = await withStep(run, "verify-sent", async () => {
        const result = await verifySent(opened.id, options);
        await captureRunScreenshot(run, opened.id, "sent-verification");
        if (!result.matched) throw new Error(`Sent verification failed. Diagnostics: ${JSON.stringify(result.visible)}`);
        return result;
      });
    }

    run.outcome = { opened, filled, draftVerified, sendResult, sentVerified };
    await overwriteRunManifest(run);
    return run;
  } catch (error) {
    run.ok = false;
    if (!run.error) {
      run.error = {
        code: inferErrorCode(error),
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }
    await overwriteRunManifest(run);
    throw error;
  }
}

function parseFlagMap(argv: string[]): { _: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return { _: positional, flags };
}

async function verifyReplyDraft(tabId: string | undefined, options: ReplyAndSendOptions) {
  const state = await getComposerState(tabId);
  const bodyText = String(state.values?.bodyText ?? "").trim();
  const bodyNeedle = options.body.trim().slice(0, 80);
  return {
    ok: Boolean(state.fieldsPresent?.body && bodyText.includes(bodyNeedle) && state.sendButtonPresent),
    state,
  };
}

async function verifyReplySent(tabId: string | undefined, options: ReplyAndSendOptions) {
  const message = await getOpenMessage(tabId);
  const bodyNeedle = options.body.trim().slice(0, 80);
  return {
    message,
    matched: String(message.bodyText ?? "").includes(bodyNeedle),
  };
}

export async function runReplyAndSendTask(options: ReplyAndSendOptions): Promise<GmailTaskRun> {
  const run: GmailTaskRun = {
    ok: true,
    adapter: "gmail",
    task: "reply-and-send",
    runId: makeRunId('reply-and-send'),
    steps: [],
    artifacts: [],
  };

  try {
    const opened = await withStep(run, "open-gmail", async () => openSite("/mail/u/0/#inbox"));
    const thread = await withStep(run, "open-thread", async () => {
      const result = await openVisibleThreadRow(options.threadIndex ?? 0, opened.id);
      await captureRunScreenshot(run, opened.id, "thread-open");
      return result;
    });

    await withStep(run, "open-reply", async () => {
      const result = await openReply(opened.id);
      await waitForComposeDialog(opened.id);
      await captureRunScreenshot(run, opened.id, "reply-open");
      return result;
    });

    const filled = await withStep(run, "fill-reply", async () => {
      const result = await fillComposeDraft({ body: options.body }, opened.id);
      await captureRunScreenshot(run, opened.id, "reply-filled");
      return result;
    });

    const replyVerified = await withStep(run, "verify-reply-draft", async () => {
      const result = await verifyReplyDraft(opened.id, options);
      if (!result.ok) throw new Error(`Reply draft verification failed. Diagnostics: ${JSON.stringify(result.state)}`);
      return result;
    });

    let sendResult: unknown = { skipped: true };
    let sentVerified: unknown = { skipped: true };
    if (options.send !== false) {
      sendResult = await withStep(run, "send-reply", async () => {
        await captureRunScreenshot(run, opened.id, "before-reply-send");
        const result = await sendCurrentCompose(opened.id);
        await captureRunScreenshot(run, opened.id, "after-reply-send");
        if ((result as { ok?: boolean }).ok !== true) throw new Error(`Reply send failed. Diagnostics: ${JSON.stringify(result)}`);
        return result;
      });

      sentVerified = await withStep(run, "verify-reply-sent", async () => {
        await waitFor(async () => {
          const verified = await verifyReplySent(opened.id, options);
          return verified.matched;
        }, 15000, 500);
        const result = await verifyReplySent(opened.id, options);
        await captureRunScreenshot(run, opened.id, "reply-sent-verification");
        if (!result.matched) throw new Error(`Reply sent verification failed. Diagnostics: ${JSON.stringify(result.message)}`);
        return result;
      });
    }

    run.outcome = { opened, thread, filled, replyVerified, sendResult, sentVerified };
    await overwriteRunManifest(run);
    return run;
  } catch (error) {
    run.ok = false;
    if (!run.error) {
      run.error = {
        code: inferErrorCode(error),
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }
    await overwriteRunManifest(run);
    throw error;
  }
}

function usage(): string {
  return [
    "Usage:",
    "  surfagent-gmail task compose-and-send --to <email> --subject <subject> --body <body> [--no-send]",
    "  surfagent-gmail task reply-and-send --body <body> [--thread-index <n>] [--no-send]",
    "  surfagent-gmail task check-mailbox --mailbox <inbox|spam|sent|drafts|outbox> [--limit <n>]",
    "  surfagent-gmail task open-latest-thread [--mailbox <inbox|spam|sent|drafts|outbox>] [--thread-index <n>]",
    "  surfagent-gmail task triage-mailbox [--mailbox <inbox|spam|sent|drafts|outbox>] [--limit <n>] [--open-best-candidate]",
  ].join("\n");
}

export async function runTaskCli(argv: string[]): Promise<number> {
  const parsed = parseFlagMap(argv);
  const [task] = parsed._;
  if (!task || task === "help" || parsed.flags.help === true) {
    console.log(usage());
    return 0;
  }

  if (task === "compose-and-send") {
    const to = String(parsed.flags.to ?? "").trim();
    const subject = String(parsed.flags.subject ?? "").trim();
    const body = String(parsed.flags.body ?? "").trim();
    if (!to || !subject || !body) {
      console.error(usage());
      return 1;
    }
    const run = await runComposeAndSendTask({
      to,
      subject,
      body,
      send: parsed.flags["no-send"] === true ? false : true,
    });
    console.log(JSON.stringify(run, null, 2));
    return 0;
  }

  if (task === "reply-and-send") {
    const body = String(parsed.flags.body ?? "").trim();
    const rawIndex = parsed.flags["thread-index"];
    const threadIndex = rawIndex === undefined || rawIndex === true ? undefined : Number(rawIndex);
    if (!body || (threadIndex !== undefined && Number.isNaN(threadIndex))) {
      console.error(usage());
      return 1;
    }
    const run = await runReplyAndSendTask({
      body,
      ...(threadIndex !== undefined ? { threadIndex } : {}),
      send: parsed.flags["no-send"] === true ? false : true,
    });
    console.log(JSON.stringify(run, null, 2));
    return 0;
  }

  if (task === "check-mailbox") {
    const mailbox = String(parsed.flags.mailbox ?? "").trim().toLowerCase() as CheckMailboxOptions["mailbox"];
    const rawLimit = parsed.flags.limit;
    const limit = rawLimit === undefined || rawLimit === true ? undefined : Number(rawLimit);
    if (!mailbox || !["inbox", "spam", "sent", "drafts", "outbox"].includes(mailbox) || (limit !== undefined && Number.isNaN(limit))) {
      console.error(usage());
      return 1;
    }
    const run = await runCheckMailboxTask({
      mailbox,
      ...(limit !== undefined ? { limit } : {}),
    });
    console.log(JSON.stringify(run, null, 2));
    return 0;
  }

  if (task === "open-latest-thread") {
    const mailboxRaw = parsed.flags.mailbox;
    const mailbox = (mailboxRaw === undefined || mailboxRaw === true ? "inbox" : String(mailboxRaw).trim().toLowerCase()) as OpenLatestThreadOptions["mailbox"];
    const rawIndex = parsed.flags["thread-index"];
    const threadIndex = rawIndex === undefined || rawIndex === true ? undefined : Number(rawIndex);
    if (!["inbox", "spam", "sent", "drafts", "outbox"].includes(mailbox ?? "inbox") || (threadIndex !== undefined && Number.isNaN(threadIndex))) {
      console.error(usage());
      return 1;
    }
    const run = await runOpenLatestThreadTask({
      ...(mailbox ? { mailbox } : {}),
      ...(threadIndex !== undefined ? { threadIndex } : {}),
    });
    console.log(JSON.stringify(run, null, 2));
    return 0;
  }

  if (task === "triage-mailbox") {
    const mailboxRaw = parsed.flags.mailbox;
    const mailbox = (mailboxRaw === undefined || mailboxRaw === true ? "inbox" : String(mailboxRaw).trim().toLowerCase()) as TriageMailboxOptions["mailbox"];
    const rawLimit = parsed.flags.limit;
    const limit = rawLimit === undefined || rawLimit === true ? undefined : Number(rawLimit);
    if (!["inbox", "spam", "sent", "drafts", "outbox"].includes(mailbox ?? "inbox") || (limit !== undefined && Number.isNaN(limit))) {
      console.error(usage());
      return 1;
    }
    const run = await runTriageMailboxTask({
      ...(mailbox ? { mailbox } : {}),
      ...(limit !== undefined ? { limit } : {}),
      openBestCandidate: parsed.flags["open-best-candidate"] === true,
    });
    console.log(JSON.stringify(run, null, 2));
    return 0;
  }

  console.error(usage());
  return 1;
}
