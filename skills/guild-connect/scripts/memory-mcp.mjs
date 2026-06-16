// guild-connect: memory-mcp.mjs (memory U10).
//
// Thin client for the member's memory data plane — Hindsight's stateless MCP
// endpoint at {dataPlaneUrl}/mcp/<bankId>/. Each call carries a FRESH Supabase
// access token (minted by the caller via credentials.mjs), which the server's
// SupabaseTenantExtension validates and scopes to this member's own schema.
// Stateless mode answers with a single JSON (sometimes SSE-framed) body.
//
// No token is logged; errors are generic (never echo the server body).

let idc = 0;

/** Parse a stateless-MCP response body: bare JSON, or a single SSE `data:` frame. */
export function parseMcpBody(text) {
  const t = String(text ?? "").trim();
  if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t);
  const data = t
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("");
  return JSON.parse(data);
}

/**
 * Pull recalled fact strings out of a `recall` tool result, tolerant of both
 * shapes the server returns: `structuredContent.results[].text` and a
 * `content[].text` JSON string. Deduped, order-preserving.
 */
export function extractRecallText(result) {
  const out = [];
  const push = (s) => {
    if (typeof s === "string" && s.trim()) out.push(s.trim());
  };
  for (const r of result?.structuredContent?.results ?? []) push(r?.text);
  if (!out.length && Array.isArray(result?.content)) {
    for (const c of result.content) {
      if (c?.type !== "text" || typeof c.text !== "string") continue;
      try {
        for (const r of JSON.parse(c.text)?.results ?? []) push(r?.text);
      } catch {
        push(c.text);
      }
    }
  }
  return [...new Set(out)];
}

async function rpc({ fetch = globalThis.fetch, dataPlaneUrl, bankId, token, name, args, timeoutMs }) {
  const res = await fetch(`${dataPlaneUrl}/mcp/${encodeURIComponent(bankId)}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++idc, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) throw new Error("memory access rejected");
  const body = parseMcpBody(await res.text());
  if (body?.error) throw new Error("memory request failed");
  return body?.result;
}

/** Recall memory relevant to `query`. Returns an array of fact strings (possibly empty). */
export async function recall({ fetch, dataPlaneUrl, bankId, token, query, timeoutMs = 8000 }) {
  const result = await rpc({ fetch, dataPlaneUrl, bankId, token, name: "recall", args: { query }, timeoutMs });
  return extractRecallText(result);
}

/** Retain `content` (waits for the store). Throws on auth/transport failure. */
export async function retain({ fetch, dataPlaneUrl, bankId, token, content, timeoutMs = 12000 }) {
  await rpc({ fetch, dataPlaneUrl, bankId, token, name: "sync_retain", args: { content }, timeoutMs });
}

// ---------------------------------------------------------------------------
// /v1 REST helpers — member management (memory U9): list, search, delete, export.
// Same member-token auth; the data plane scopes everything to the member's schema.
// ---------------------------------------------------------------------------

/** Pick the fields the CLI surfaces from a memory entry (list or recall result). */
function toEntry(raw) {
  const r = raw ?? {};
  return {
    id: typeof r.id === "string" ? r.id : "",
    text: typeof r.text === "string" ? r.text : "",
    fact_type: typeof r.fact_type === "string" ? r.fact_type : "",
    date: typeof r.date === "string" ? r.date : typeof r.mentioned_at === "string" ? r.mentioned_at : null,
    document_id: typeof r.document_id === "string" ? r.document_id : null,
  };
}

async function v1Fetch({ fetch = globalThis.fetch, dataPlaneUrl, bankId, token, method, path, timeoutMs = 15000 }) {
  const res = await fetch(`${dataPlaneUrl}/v1/default/banks/${encodeURIComponent(bankId)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) throw new Error("memory access rejected");
  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, body };
}

/** One page of the member's memories. */
export async function listMemories({ fetch, dataPlaneUrl, bankId, token, limit = 100, offset = 0 }) {
  const res = await v1Fetch({ fetch, dataPlaneUrl, bankId, token, method: "GET", path: `/memories/list?limit=${limit}&offset=${offset}` });
  if (res.status !== 200) throw new Error(`memory list failed (HTTP ${res.status})`);
  const b = res.body ?? {};
  return { items: Array.isArray(b.items) ? b.items.map(toEntry) : [], total: typeof b.total === "number" ? b.total : 0 };
}

/** Every memory the member holds, paged — for export. Bounded. */
export async function listAllMemories({ fetch, dataPlaneUrl, bankId, token, pageSize = 200, maxItems = 5000 }) {
  const all = [];
  for (let offset = 0; ; ) {
    const { items, total } = await listMemories({ fetch, dataPlaneUrl, bankId, token, limit: pageSize, offset });
    all.push(...items);
    offset += items.length;
    if (items.length === 0 || all.length >= total || all.length >= maxItems) break;
  }
  return all;
}

/** Semantic search → structured matches (id, text, document_id) so the AI can pick what to forget. */
export async function searchMemories({ fetch, dataPlaneUrl, bankId, token, query, timeoutMs = 8000 }) {
  const result = await rpc({ fetch, dataPlaneUrl, bankId, token, name: "recall", args: { query }, timeoutMs });
  const out = [];
  for (const r of result?.structuredContent?.results ?? []) out.push(toEntry(r));
  if (!out.length && Array.isArray(result?.content)) {
    for (const c of result.content) {
      if (c?.type !== "text" || typeof c.text !== "string") continue;
      try {
        for (const r of JSON.parse(c.text)?.results ?? []) out.push(toEntry(r));
      } catch {
        /* skip */
      }
    }
  }
  return out.filter((e) => e.text);
}

/** Forget one memory by its source document (clean delete). Idempotent (404 = ok). */
export async function deleteDocument({ fetch, dataPlaneUrl, bankId, token, documentId }) {
  const res = await v1Fetch({ fetch, dataPlaneUrl, bankId, token, method: "DELETE", path: `/documents/${encodeURIComponent(documentId)}` });
  if (res.status === 200 || res.status === 204 || res.status === 404) return;
  throw new Error(`memory forget failed (HTTP ${res.status})`);
}
