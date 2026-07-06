// guild-skills: provenance lockfile v2 (skills-delivery U5, R11/R16).
//
// Extends the existing skills-lock.json shape (source / sourceType / skillPath /
// computedHash) with the fields the installer needs: pinnedCommit, scope, fork,
// catalogSlug, and originalSource. One lockfile per scope root
// (<root>/skills-lock.json). Writes are per-skill atomic (whole-file tmp+rename)
// and re-running install is idempotent.
//
// Fail-closed: a lockfile that exists but does not parse as a v2-shaped object
// makes reads THROW rather than silently returning an empty set — otherwise the
// installer could overwrite skills it has simply failed to see.

import { readFile, writeFile, rename, mkdir, unlink, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

export const LOCKFILE_VERSION = 2;

export class LockfileError extends Error {
  constructor(message) {
    super(message);
    this.name = "LockfileError";
  }
}

/**
 * Read a lockfile. A missing file is the empty state ({ version, skills: {} }).
 * A present-but-corrupt file throws LockfileError (fail closed).
 */
export async function readLockfile(lockfilePath) {
  let raw;
  try {
    raw = await readFile(lockfilePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return { version: LOCKFILE_VERSION, skills: {} };
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LockfileError(
      `The lockfile at ${lockfilePath} is not valid JSON. Fix or remove it before installing.`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || typeof parsed.skills !== "object" || parsed.skills === null) {
    throw new LockfileError(
      `The lockfile at ${lockfilePath} is not in the expected shape. Fix or remove it before installing.`,
    );
  }
  return { version: parsed.version ?? LOCKFILE_VERSION, skills: parsed.skills };
}

/** Atomic whole-file write: tmp in the same dir, then rename over the target. */
export async function writeLockfile(lockfilePath, lock) {
  await mkdir(dirname(lockfilePath), { recursive: true });
  const tmp = join(dirname(lockfilePath), `.skills-lock-${randomBytes(6).toString("hex")}.tmp`);
  const body = { version: LOCKFILE_VERSION, skills: lock.skills };
  try {
    await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`);
    await rename(tmp, lockfilePath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Upsert one skill's entry and persist (per-skill atomic). */
export async function upsertEntry(lockfilePath, slug, entry) {
  const lock = await readLockfile(lockfilePath);
  lock.skills[slug] = entry;
  await writeLockfile(lockfilePath, lock);
}

/** Remove one skill's entry and persist; no-op if absent. */
export async function removeEntry(lockfilePath, slug) {
  const lock = await readLockfile(lockfilePath);
  if (!(slug in lock.skills)) return false;
  delete lock.skills[slug];
  await writeLockfile(lockfilePath, lock);
  return true;
}

/**
 * Content hash of an installed skill directory: sha256 over a manifest of every
 * file's repo-relative path + bytes, sorted by path so the digest is stable
 * regardless of readdir order. v2 skills are directories (v1 hashed a single
 * file); this is the one rule for the file-vs-directory difference. A missing
 * directory hashes to null (the "no longer on disk" signal).
 */
export async function hashSkillDir(dir) {
  let files;
  try {
    files = await collectFiles(dir, dir);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(f.rel);
    hash.update("\0");
    hash.update(await readFile(f.abs));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function collectFiles(root, dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await collectFiles(root, abs)));
    } else if (e.isFile()) {
      out.push({ abs, rel: abs.slice(root.length + 1).split("\\").join("/") });
    }
  }
  return out;
}

/**
 * Compare an installed skill's on-disk content against the hash the lockfile
 * recorded. Returns "clean" (matches), "modified" (differs), or "missing" (the
 * directory is gone). Local modification detection is what gates R20.
 */
export async function localState(skillDir, recordedHash) {
  const current = await hashSkillDir(skillDir);
  if (current === null) return "missing";
  return current === recordedHash ? "clean" : "modified";
}
