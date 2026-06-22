// guild-memory: memory-config.mjs (memory U10).
//
// Local record of WHERE this member's memory lives — the data-plane base URL and
// their bank id — written once by memory-setup and read by the capture hooks
// (memory-hook.mjs). It holds NO secret: the bearer is minted fresh per call from
// the durable Guild credential (credentials.mjs), never stored here. Lives beside
// credentials.json in the shared guild config dir, 0600.

import { dirname, join } from "node:path";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { credentialsPath } from "../../guild-connect/scripts/credentials.mjs";

export function memoryConfigPath() {
  return join(dirname(credentialsPath()), "memory.json");
}

/** Read + validate the memory config, or null when absent/malformed (capture stays off). */
export async function readMemoryConfig() {
  let raw;
  try {
    raw = await readFile(memoryConfigPath(), "utf8");
  } catch {
    return null;
  }
  try {
    const j = JSON.parse(raw);
    const dataPlaneUrl = typeof j?.dataPlaneUrl === "string" ? j.dataPlaneUrl.replace(/\/+$/, "") : "";
    const bankId = typeof j?.bankId === "string" ? j.bankId : "";
    if (!dataPlaneUrl || !bankId) return null;
    return { dataPlaneUrl, bankId };
  } catch {
    return null;
  }
}

/** Persist the memory endpoint for this member (0600). Returns the path written. */
export async function writeMemoryConfig({ dataPlaneUrl, bankId }) {
  const p = memoryConfigPath();
  await mkdir(dirname(p), { recursive: true });
  const body = JSON.stringify(
    { dataPlaneUrl: String(dataPlaneUrl).replace(/\/+$/, ""), bankId: String(bankId) },
    null,
    2,
  );
  await writeFile(p, `${body}\n`, { mode: 0o600 });
  await chmod(p, 0o600).catch(() => {});
  return p;
}
