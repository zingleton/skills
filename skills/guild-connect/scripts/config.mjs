// guild-connect embedded constants (skill U7, KTD8).
//
// The skill ships pointing at the PRODUCTION stack: the embedded defaults are
// the hosted Supabase project + the public site. They are overridable via env
// vars for local development and tests ONLY — members never need to set them.
// The env vars hold endpoints/keys-that-are-public, never token material.
//
// Pre-ship (SKILL.md checklist): verify the embedded anon key's format against
// the live project immediately before publishing — a future key migration
// (legacy JWT anon key vs sb_publishable_*) would otherwise strand deployed
// copies, which connect.mjs surfaces as the "outdated skill" branch.

const trimSlash = (u) => String(u).replace(/\/+$/, "");

/** Supabase project URL (GoTrue lives under /auth/v1). */
export const SUPABASE_URL = trimSlash(
  process.env.GUILD_SUPABASE_URL || "https://vygrdyamjofjxifvhzvd.supabase.co",
);

/** Public (anon/publishable) API key — safe to embed; RLS is the boundary. */
export const ANON_KEY =
  process.env.GUILD_ANON_KEY || "sb_publishable_lwWCY9YFEGqfn2LYTrBPKA_xUVcAaKF";

/** The app's base URL — every data call goes through its /api routes (R6). */
export const SITE_URL = trimSlash(
  process.env.GUILD_SITE_URL || "https://pg.singleton.ai",
);
