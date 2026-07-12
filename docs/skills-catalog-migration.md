# Skills catalog migration (skills-delivery U8, R13/R14)

The bootstrap now installs only `guild-connect` + `guild-skills`. The Chief of
Staff setup and portable memory ship as **catalog entries** and are installed on
demand with `guild-skills install`. This doc is the operational runbook for
seeding those entries — it is content work through the app's curation API, not a
code migration.

## No adoption/migration of existing installs

Existing hand-installed copies of `claudecof-setup` / `guild-memory` are not
migrated. There are only a few active users; they reinstall through the
installer. Where an old copy is encountered it can simply be removed.

## Seed the all-users package (Chief of Staff)

With a guide or admin Guild credential (a bearer token from a connected
guide/admin account), create the catalog entries via
`POST /api/skills-catalog/manage`. Pin each entry at the **current commit** of
the skill in `zingleton/skills` (the curator-evaluated pin — never a moving
branch):

```
# resolve the pin to catalogue
git -C <zingleton/skills checkout> rev-parse HEAD

# body (camelCase); repeat per skill
{
  "slug": "chief-of-staff-setup",
  "name": "Chief of Staff setup",
  "description": "Scaffold a Personal Chief of Staff project that reads and responds to email.",
  "sourceRepo": "zingleton/skills",
  "sourcePath": "skills/claudecof-setup",
  "pinnedCommit": "<sha>",
  "strength": 3,
  "recommendedForAll": true
}
```

Create a second `recommended_for_all` entry for `skills/guild-memory` the same
way (strength 2–3 as desired). Entries are created at strength 0 (hidden) if
`strength` is omitted; set `strength` explicitly to publish, or raise it later
with `PATCH /api/skills-catalog/manage/<id>`.

## Seed the guide management skills (guild-content, guild-catalog)

After the app's content-manage API and the plugin's 0.6.0 release ship
(content-manage U6–U8), seed the two guide-facing skills the same way —
visible strength is safe: the management APIs 403 non-guides, and the
descriptions say "as a guide or admin". Once `guild-catalog` itself is seeded
and installed, later curation can go through it instead of raw API calls
(`node scripts/add.mjs <payload.json>`).

```
# resolve the pin (the commit you just reviewed/released)
git -C <zingleton/skills checkout> rev-parse HEAD

{
  "slug": "guild-content",
  "name": "Guild content management",
  "description": "For guides and admins: find, post, edit, and retract guild news and reviews from your AI client.",
  "sourceRepo": "zingleton/skills",
  "sourcePath": "skills/guild-content",
  "pinnedCommit": "<sha>",
  "strength": 2
}

{
  "slug": "guild-catalog",
  "name": "Skills catalog curation",
  "description": "For guides and admins: add, edit, re-pin, and remove skills-catalog entries and their role/task targeting.",
  "sourceRepo": "zingleton/skills",
  "sourcePath": "skills/guild-catalog",
  "pinnedCommit": "<sha>",
  "strength": 2
}
```

Deploy order for the whole feature: `supabase db push` (migration 0031) → app
deploy (content routes + llms.txt) → skills-repo release (this plugin) → seed
these entries.

## Seed the first role package (AI-powered investor, R14)

Once the app-side and installer ship, catalogue the investor-pack skills the
same way — mostly external-authored repos plus guild-modified copies. A
guild-modified copy points `sourceRepo`/`sourcePath` at the guild-owned repo and
records the external author in `originalSourceRepo`/`originalSourcePath`. Tag
each with the investor role (`roleKeys: ["investor"]`) and an appropriate
strength. This is curator content work, not part of the code change.

## Deploy order

App-side first, then the skills release: `supabase db push` (migration 0026) →
app deploy (the catalog + curation APIs) → publish the `guild-skills` release →
seed the catalog entries above.
