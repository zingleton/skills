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
