// scaffold.mjs tests — the local COF wrapper writer + skills linking. Uses real
// temp directories so the Windows junction path (and the copy fallback) are
// exercised for real. node:test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access, lstat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scaffold, linkSkills, linksBlock } from "../scripts/scaffold.mjs";

function tmp() {
  return mkdtemp(join(tmpdir(), "cof-scaffold-"));
}
async function exists(p) {
  return access(p).then(() => true, () => false);
}

// --- linksBlock (pure) ------------------------------------------------------

test("linksBlock builds email + links, empty when nothing supplied", () => {
  assert.equal(linksBlock({}), "");
  assert.equal(linksBlock({ email: "a@b.c" }), "- Email: a@b.c");
  const b = linksBlock({ email: "a@b.c", links: [{ label: "Site", url: "https://x" }, { url: "https://y" }] });
  assert.match(b, /- Email: a@b\.c/);
  assert.match(b, /- Site: https:\/\/x/);
  assert.match(b, /- Link: https:\/\/y/);
});

// --- scaffold ---------------------------------------------------------------

test("scaffold writes CLAUDE.md + Notes and no project-root memory/ or Tools/", async () => {
  const dir = await tmp();
  try {
    const r = await scaffold({
      targetDir: dir,
      name: "Ada",
      aboutMe: "founder",
      email: "ada@x.dev",
      links: [{ label: "Site", url: "https://ada.dev" }],
    });
    assert.equal(r.ok, true);
    assert.ok(await exists(join(dir, "CLAUDE.md")));
    assert.ok(await exists(join(dir, "Notes", "chief-of-staff-guide.md")));
    assert.equal(await exists(join(dir, "memory")), false, "no project-root memory/");
    assert.equal(await exists(join(dir, "Tools")), false, "no project-root Tools/");

    const md = await readFile(join(dir, "CLAUDE.md"), "utf8");
    assert.match(md, /Ada/);
    assert.match(md, /ada@x\.dev/);
    assert.match(md, /https:\/\/ada\.dev/);
    assert.match(md, /repo\/memory\/MEMORY\.md/, "points at the new memory location");
    assert.doesNotMatch(md, /context\.txt|conversations\//, "no retired memory format");
    assert.equal(r.skillsLink, "no-source", "no repo/skills yet → no link");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffold refuses to overwrite an existing CLAUDE.md without force", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "CLAUDE.md"), "custom config");
    const r = await scaffold({ targetDir: dir });
    assert.equal(r.ok, false);
    assert.equal(r.status, "exists");
    assert.equal(await readFile(join(dir, "CLAUDE.md"), "utf8"), "custom config", "left untouched");

    const forced = await scaffold({ targetDir: dir, force: true, name: "Z" });
    assert.equal(forced.ok, true);
    assert.match(await readFile(join(dir, "CLAUDE.md"), "utf8"), /Z/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffold result uses forward-slash paths and links skills when repo/skills exists", async () => {
  const dir = await tmp();
  try {
    await mkdir(join(dir, "repo", "skills", "demo"), { recursive: true });
    await writeFile(join(dir, "repo", "skills", "demo", "SKILL.md"), "x");
    const r = await scaffold({ targetDir: dir });
    assert.ok(r.created.includes("CLAUDE.md"));
    assert.ok(r.created.includes("Notes/chief-of-staff-guide.md"));
    assert.ok(r.created.includes(".claude/skills"));
    for (const p of [...r.created, ...r.skipped]) {
      assert.ok(!p.includes("\\"), `no backslashes in ${p}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- linkSkills -------------------------------------------------------------

test("linkSkills creates .claude/skills resolving to repo/skills (real link)", async () => {
  const dir = await tmp();
  try {
    await mkdir(join(dir, "repo", "skills", "demo"), { recursive: true });
    await writeFile(join(dir, "repo", "skills", "demo", "SKILL.md"), "x");

    const res = await linkSkills(dir);
    assert.equal(res.status, "linked");
    assert.ok(await exists(join(dir, ".claude", "skills", "demo", "SKILL.md")), "reads through the link");
    assert.equal(
      await realpath(join(dir, ".claude", "skills")),
      await realpath(join(dir, "repo", "skills")),
      "link resolves to repo/skills",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("linkSkills falls back to a recursive copy when linking throws", async () => {
  const dir = await tmp();
  try {
    await mkdir(join(dir, "repo", "skills", "demo"), { recursive: true });
    await writeFile(join(dir, "repo", "skills", "demo", "SKILL.md"), "hello");

    const res = await linkSkills(dir, {
      platform: "win32",
      symlink: async () => {
        const e = new Error("no privilege");
        e.code = "EPERM";
        throw e;
      },
    });
    assert.equal(res.status, "copied");
    assert.equal(
      await readFile(join(dir, ".claude", "skills", "demo", "SKILL.md"), "utf8"),
      "hello",
      "copied content matches",
    );
    const st = await lstat(join(dir, ".claude", "skills"));
    assert.equal(st.isSymbolicLink(), false, "fallback is a real dir, not a link");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("linkSkills is a no-op when repo/skills is absent", async () => {
  const dir = await tmp();
  try {
    const res = await linkSkills(dir);
    assert.equal(res.status, "no-source");
    assert.equal(await exists(join(dir, ".claude")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
