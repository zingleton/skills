#!/usr/bin/env node
// guild-memory: memory.mjs (memory U9). The AI-client surface for managing the
// member's portable memory — the agent-native counterpart to the (deliberately
// light) web /memory page. Subcommands:
//
//   search <query>     semantic search → matches (with document_id) the agent can act on
//   list [--limit N]   list stored memories
//   export             print the whole corpus as JSON (open format; R9)
//   forget <documentId>  delete one memory by its source document (R8)
//
// Typical "forget" flow: `search <what to forget>` to find the entry, then
// `forget <its document_id>`. Derived observations have no document_id and aren't
// individually deletable — the web's "delete all" (or account deletion) clears those.
//
// Auth: reuses the durable Guild credential — each call mints a FRESH Supabase
// access token (getValidAccessToken), scoped by the data plane to the member's
// own memory. Requires `memory-setup` to have run (writes the local endpoint).

import { pathToFileURL } from "node:url";
import { actingAs, runCommand } from "../../guild-connect/scripts/api.mjs";
import { getValidAccessToken } from "../../guild-connect/scripts/credentials.mjs";
import { readMemoryConfig } from "./memory-config.mjs";
import { deleteDocument, listAllMemories, listMemories, searchMemories } from "./memory-mcp.mjs";

const USAGE = "Usage: memory.mjs <search <query> | list [--limit N] | export | forget <documentId>>";

/** A locally classified failure whose message is safe to print. */
export class MemoryCommandError extends Error {
  constructor(message) {
    super(message);
    this.name = "MemoryCommandError";
  }
}

function parseLimit(argv) {
  const i = argv.indexOf("--limit");
  if (i >= 0 && argv[i + 1]) {
    const n = Number.parseInt(argv[i + 1], 10);
    if (Number.isFinite(n) && n > 0) return Math.min(n, 1000);
  }
  return 100;
}

/**
 * deps: readConfig() → {dataPlaneUrl, bankId} | null; getToken() → {accessToken};
 * search/list/listAll/forget → the memory-mcp data-plane calls.
 */
export async function runMemory(deps, argv) {
  const cmd = argv[0];

  async function ctx() {
    const cfg = await deps.readConfig();
    if (!cfg) throw new MemoryCommandError("Memory isn't set up on this machine. Run memory-setup first.");
    const { accessToken } = await deps.getToken();
    return { dataPlaneUrl: cfg.dataPlaneUrl, bankId: cfg.bankId, token: accessToken };
  }

  if (cmd === "search") {
    const query = argv.slice(1).join(" ").trim();
    if (!query) throw new MemoryCommandError("Usage: memory.mjs search <query>");
    const matches = await deps.search({ ...(await ctx()), query });
    return { ok: true, query, count: matches.length, matches };
  }
  if (cmd === "list") {
    const limit = parseLimit(argv);
    const { items, total } = await deps.list({ ...(await ctx()), limit });
    return { ok: true, total, count: items.length, memories: items };
  }
  if (cmd === "export") {
    const memories = await deps.listAll(await ctx());
    return { ok: true, count: memories.length, memories };
  }
  if (cmd === "forget") {
    const documentId = argv[1];
    if (!documentId) {
      throw new MemoryCommandError(
        "Usage: memory.mjs forget <documentId>  (find it first with: memory.mjs search <query>)",
      );
    }
    await deps.forget({ ...(await ctx()), documentId });
    return { ok: true, forgotten: documentId };
  }

  throw new MemoryCommandError(USAGE);
}

// CLI wiring — banner first (SKILL.md hard rule), then runCommand.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(async () => {
    await actingAs();
    return runMemory(
      {
        readConfig: readMemoryConfig,
        getToken: () => getValidAccessToken(),
        search: (a) => searchMemories(a),
        list: (a) => listMemories(a),
        listAll: (a) => listAllMemories(a),
        forget: (a) => deleteDocument(a),
      },
      process.argv.slice(2),
    );
  });
}
