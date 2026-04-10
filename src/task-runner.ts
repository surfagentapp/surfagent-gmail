import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { screenshot } from "./connection.js";
import { extractVisible, fillComposeDraft, getComposerState, getOpenMessage, getSiteState, openCompose, openReply, openSent, openSite, openVisibleThreadRow, sendCurrentCompose } from "./site.js";

export type GmailTaskKind = "compose-and-send" | "reply-and-send";

type TaskStepStatus = "started" | "completed" | "failed";

type TaskStep = {
  name: string;
  status: TaskStepStatus;
  startedAt: string;
  finishedAt?: string;
  details?: unknown;
};

type ScreenshotArtifact = {
  label: string;
  path: string;
  takenAt: string;
};

export type GmailTaskRun = {
  ok: boolean;
  adapter: "gmail";
  task: GmailTaskKind;
  runId: string;
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

const RUN_ROOT = process.env.SURFAGENT_RUN_DIR || join(tmpdir(), "surfagent-gmail-runs");

function isoNow(): string {
  return new Date().toISOString();
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "run";
}

function cleanBase64Image(input: string): string {
  const value = input.trim();
  const comma = value.indexOf(",");
  return value.startsWith("data:") && comma >= 0 ? value.slice(comma + 1) : value;
}

async function ensureRunDir(runId: string): Promise<string> {
  const dir = join(RUN_ROOT, runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeRunFile(runId: string, filename: string, content: string | Buffer, encoding?: BufferEncoding): Promise<string> {
  const dir = await ensureRunDir(runId);
  const fullPath = join(dir, filename);
  if (typeof content === "string") await writeFile(fullPath, content, encoding ?? "utf8");
  else await writeFile(fullPath, content);
  return fullPath;
}

async function overwriteRunManifest(run: GmailTaskRun): Promise<string> {
  return writeRunFile(run.runId, "run.json", JSON.stringify(run, null, 2));
}

async function captureRunScreenshot(run: GmailTaskRun, tabId: string | undefined, label: string): Promise<ScreenshotArtifact> {
  const image = await screenshot(tabId);
  const payload = cleanBase64Image(image);
  const path = await writeRunFile(run.runId, `${String(run.artifacts.length + 1).padStart(2, "0")}-${slug(label)}.png`, Buffer.from(payload, "base64"));
  const artifact = { label, path, takenAt: isoNow() };
  run.artifacts.push(artifact);
  await overwriteRunManifest(run);
  return artifact;
}

async function withStep<T>(run: GmailTaskRun, name: string, fn: () => Promise<T>): Promise<T> {
  const step: TaskStep = { name, status: "started", startedAt: isoNow() };
  run.steps.push(step);
  await overwriteRunManifest(run);
  try {
    const result = await fn();
    step.status = "completed";
    step.finishedAt = isoNow();
    step.details = result;
    await overwriteRunManifest(run);
    return result;
  } catch (error) {
    step.status = "failed";
    step.finishedAt = isoNow();
    step.details = error instanceof Error ? error.message : String(error);
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

export async function runComposeAndSendTask(options: ComposeAndSendOptions): Promise<GmailTaskRun> {
  const run: GmailTaskRun = {
    ok: true,
    adapter: "gmail",
    task: "compose-and-send",
    runId: `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${slug(options.subject)}-compose-and-send`,
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
    runId: `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-reply-and-send`,
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

  console.error(usage());
  return 1;
}
