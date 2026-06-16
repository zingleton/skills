#!/usr/bin/env node
// guild-connect: memory-setup.mjs (memory U10).
//
// One-time: connects this member's portable memory. It provisions the member's
// memory bank server-side and records WHERE it lives locally, so the plugin's
// capture hooks (memory-hook.mjs) start carrying memory across Claude Code
// sessions — with no token to manage (each hook mints a fresh one).
//
// Flow:
//   1. POST /api/account/memory-access with the stored Guild credential → the
//      member's data-plane URL + bank id (no secret in the response),
//   2. write that to the local memory config (memory-config.mjs),
//   3. verify end-to-end: mint a fresh access token and do a read-only recall
//      against the member's own bank — proving auth, routing, and schema init,
//   4. print guidance. Re-running re-verifies (no retry loop).
//
// Capture itself is the plugin's hooks (UserPromptSubmit/Stop), so there is no
// client to install here — just the endpoint record + a connectivity check.

import { pathToFileURL } from "node:url";
import { actingAs, postJson, runCommand } from "./api.mjs";
import { getValidAccessToken } from "./credentials.mjs";
import { writeMemoryConfig } from "./memory-config.mjs";
import { recall } from "./memory-mcp.mjs";

/** A locally classified memory-setup failure whose message is safe to print. */
export class MemorySetupError extends Error {
  constructor(message) {
    super(message);
    this.name = "MemorySetupError";
  }
}

/**
 * deps:
 *   requestAccess() → { dataPlaneUrl, bankId }   (POST /api/account/memory-access)
 *   writeConfig({dataPlaneUrl, bankId}) → path
 *   getToken() → { accessToken }                 (fresh Supabase token)
 *   verifyRecall({dataPlaneUrl, bankId, token}) → any   (read-only round-trip)
 *   log(line): void
 */
export async function runMemorySetup(deps) {
  const access = await deps.requestAccess();
  const dataPlaneUrl = String(access?.dataPlaneUrl ?? "").replace(/\/+$/, "");
  const bankId = access?.bankId;
  if (!dataPlaneUrl || !bankId) {
    throw new MemorySetupError(
      "The server didn't return a usable memory endpoint. Run memory-setup again.",
    );
  }

  await deps.writeConfig({ dataPlaneUrl, bankId });

  // Verify the whole chain with the member's own token (read-only recall also
  // initializes their schema on first use). A failure here means the endpoint or
  // token path is wrong — surface it rather than leaving a half-set-up state.
  try {
    const { accessToken } = await deps.getToken();
    await deps.verifyRecall({ dataPlaneUrl, bankId, token: accessToken });
  } catch {
    throw new MemorySetupError(
      "Saved the memory endpoint, but a test connection failed. Check your network, then run memory-setup again.",
    );
  }

  deps.log(
    "Memory is connected. Your AI Power Guild memory now follows you across Claude Code sessions on this machine — " +
      "the plugin recalls what's relevant before each prompt and saves new context after each turn, with no token to manage.",
  );
  // Machine-readable result — endpoint + bank only, never a token.
  return { ok: true, dataPlaneUrl, bankId };
}

// CLI wiring (real deps). Banner first (SKILL.md hard rule), then runCommand.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(async () => {
    await actingAs();
    return runMemorySetup({
      requestAccess: () => postJson("/api/account/memory-access", {}),
      writeConfig: writeMemoryConfig,
      getToken: () => getValidAccessToken(),
      verifyRecall: ({ dataPlaneUrl, bankId, token }) =>
        recall({ dataPlaneUrl, bankId, token, query: "connection check", timeoutMs: 10000 }),
      log: (line) => process.stderr.write(`${line}\n`),
    });
  });
}
