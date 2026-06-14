#!/usr/bin/env node
// guild-connect: avatar.mjs — set the member's profile photo by uploading
// image bytes (POST /api/user-profile/avatar, KTD6).
//
//   node avatar.mjs upload <path-to-image>
//   node avatar.mjs remove
//
// The choreography (SKILL.md): the AI downloads a candidate photo LOCALLY,
// describes it, gets the member's approval, then uploads the bytes here. The
// server never fetches URLs on this path.
//
// Client-side validation before any network call: ≤ 2MB, and the file's REAL
// magic bytes must be JPEG, PNG, or WebP (the server re-validates with the
// same rules and rejects spoofed types).
//
// `remove` deletes the current photo (web parity with the editor's Remove
// button): a read-merge-write POST /api/user-profile carrying the existing
// fields unchanged plus picture {state: "removed"}.

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { actingAs, getJson, postBytes, postJson, runCommand } from "./api.mjs";

const MAX_BYTES = 2 * 1024 * 1024; // AVATAR_MAX_BYTES on the server

/** Sniff the real content type from magic bytes; null when unsupported. */
export function sniffImageType(bytes) {
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

async function upload(filePath) {
  if (!filePath) throw new Error("Usage: node avatar.mjs upload <path-to-image>");
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new Error(`Could not read the file at ${filePath}.`);
  }
  if (bytes.length === 0) throw new Error("That file is empty.");
  if (bytes.length > MAX_BYTES) {
    throw new Error("That image is too large. Avatars must be 2MB or smaller.");
  }
  const contentType = sniffImageType(bytes);
  if (contentType === null) {
    throw new Error("Unsupported image format. Use a JPEG, PNG, or WebP file.");
  }
  await actingAs();
  return postBytes("/api/user-profile/avatar", bytes, contentType);
}

async function remove() {
  await actingAs();
  // Read-merge-write (SKILL.md hard rule): carry the current fields through
  // unchanged so removing the photo never clears the rest of the profile.
  const current = await getJson("/api/user-profile");
  const row = current.profile ?? {};
  const payload = {
    displayName: row.display_name ?? null,
    websiteUrl: row.website_url ?? null,
    linkedinUrl: row.linkedin_url ?? null,
    youtubeUrl: row.youtube_url ?? null,
    description: row.description ?? null,
    picture: { state: "removed" },
  };
  return postJson("/api/user-profile", payload);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , command, filePath] = process.argv;
  runCommand(() => {
    if (command === "upload") return upload(filePath);
    if (command === "remove") return remove();
    throw new Error("Usage: node avatar.mjs <upload <path-to-image> | remove>");
  });
}
