#!/usr/bin/env node
// guild-connect: memory-hook.mjs (memory U10).
//
// Claude Code hook handler that wires the member's memory into every session,
// shipped IN the ai-power-guild plugin (plugin.json registers it), so installing
// the plugin + running memory-setup is all it takes. Two modes (argv[2]):
//
//   recall  — UserPromptSubmit: recall memory relevant to the prompt and inject
//             it as additionalContext (stdout JSON), so the model starts the turn
//             already knowing the member.
//   retain  — Stop: distil the latest exchange from the transcript into memory.
//
// Rotation is solved here: each invocation mints a FRESH Supabase access token
// via credentials.mjs (no static token anywhere), which the data plane validates
// and scopes to this member's schema. FAIL-OPEN is the cardinal rule — any
// error (not set up, offline, token expired, slow) exits 0 with no output so
// memory NEVER blocks or breaks the user's session.

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getValidAccessToken } from "./credentials.mjs";
import { readMemoryConfig } from "./memory-config.mjs";
import { recall, retain } from "./memory-mcp.mjs";

/** Read all of stdin and parse it as the hook's JSON event; {} on anything odd. */
export async function readStdinJson(stream = process.stdin) {
  let raw = "";
  stream.setEncoding("utf8");
  for await (const chunk of stream) raw += chunk;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Flatten a transcript message's `content` (string, or array of blocks) to text. */
export function blockText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * From a Claude Code transcript JSONL, build the latest user→assistant exchange
 * to retain. Tolerant of unknown line shapes (skips them). Returns "" when there
 * is nothing worth storing.
 */
export function extractLastExchange(jsonlText) {
  let lastUser = "";
  let lastAssistant = "";
  for (const line of String(jsonlText ?? "").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let obj;
    try {
      obj = JSON.parse(s);
    } catch {
      continue;
    }
    const role = obj?.message?.role ?? obj?.role;
    const text = blockText(obj?.message?.content ?? obj?.content);
    if (!text) continue;
    if (role === "user") lastUser = text;
    else if (role === "assistant") lastAssistant = text;
  }
  const parts = [];
  if (lastUser) parts.push(`User: ${lastUser}`);
  if (lastAssistant) parts.push(`Assistant: ${lastAssistant}`);
  return parts.join("\n\n");
}

/** Wrap recalled facts as the additionalContext payload Claude Code injects. */
export function buildRecallOutput(facts) {
  if (!facts?.length) return null;
  const additionalContext =
    "Relevant memory about this user, from their AI Power Guild memory — use it if helpful:\n" +
    facts.map((f) => `- ${f}`).join("\n");
  return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } };
}

async function doRecall(input, cfg) {
  const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return;
  const { accessToken } = await getValidAccessToken();
  const facts = await recall({ ...cfg, token: accessToken, query: prompt, timeoutMs: 8000 });
  const out = buildRecallOutput(facts);
  if (out) process.stdout.write(JSON.stringify(out));
}

async function doRetain(input, cfg) {
  const tp = input?.transcript_path;
  if (typeof tp !== "string" || !tp) return;
  let text;
  try {
    text = await readFile(tp, "utf8");
  } catch {
    return;
  }
  const content = extractLastExchange(text);
  if (!content) return;
  const { accessToken } = await getValidAccessToken();
  await retain({ ...cfg, token: accessToken, content, timeoutMs: 12000 });
}

// CLI: dispatch by mode, swallow every error (fail-open), always exit 0.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    try {
      const cfg = await readMemoryConfig();
      if (cfg) {
        const input = await readStdinJson();
        if (process.argv[2] === "recall") await doRecall(input, cfg);
        else if (process.argv[2] === "retain") await doRetain(input, cfg);
      }
    } catch {
      // Fail-open: memory must never break the session.
    }
    process.exit(0);
  })();
}
