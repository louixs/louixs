# 2026-07-29 — Post-merge fix pass: light mode, pin duping, stats

Status of the 2026-07-22 full-replacement design after merging to the live profile:
George's verdict — "looks really bad" in light mode. Three concrete failures, each
diagnosed below with the fix applied and the lesson to transfer into the
`github-profile-10x` skill.

## Failure 1 — bold light-mode background clashes with GitHub's white page

**What shipped:** `hero-light.svg` (and panel light variants) used a bold navy
block (`#122F4E`) as background, per the design-language rule "blend exactly or
commit to bold — never near-miss neutrals."

**What happened live:** GitHub's light page is white. A large saturated navy
rectangle sitting on white chrome reads as a clashing foreign object, not a
poster. The "bold" branch of the background rule failed in situ even though it
passed the pre-ship crit on isolated renders.

**Fix:** recolor light variants to background exactly `#ffffff` (page-blend),
geometry identical to dark variants, accents darkened to meet WCAG (≥4.5:1
text, ≥3:1 motif strokes vs white).

**Skill transfer:** the background rule needs a stronger default: for PROFILE
BANNERS specifically, blend-with-page should be the default for BOTH modes;
"bold block" requires explicit user opt-in after seeing it composited on a
real GitHub page screenshot, not an isolated render. The crit loop must
composite candidates onto the actual page chrome (white `#ffffff` / dark
`#0d1117`) before scoring.

## Failure 2 — README featured-repo table duplicates GitHub pins

**What shipped:** README table featuring onebreath, tsushin,
ubersicht_google_calendar, ubersicht_gmail — exactly the four repos pinned on
the live profile. Rendered result: the same four repos listed twice on one
page.

**Root cause (misconception):** the profile README does not *override* the
profile page — it renders ABOVE the pinned-repos block. Pins always render;
unpinning everything just makes GitHub substitute an automatic "Popular
repositories" block (usually the same repos). Duplication cannot be fixed by
removing pins; it must be designed around.

**Fix:** README stops being a repo list. It carries identity (banner, intro,
live palette-matched badges, stats data-art); pins carry the repo index.
Complementary, not duplicative.

**Skill transfer:** add to step 5 (compose the README): "The profile page =
README + pins + (optionally) contribution graph, always stacked in that
order. Design the README as the layer pins CANNOT provide — identity, live
data, narrative. Never enumerate the pinned repos in the README; check the
live pins during research (step 1) and treat them as part of the page you are
composing."

## Failure 3 — stats not eye-popping; badge rainbow off-palette

**What shipped:** four shields badges, each in a different arbitrary hue
(red / cyan / green / magenta) — violating the palette discipline the rest of
the identity followed, and reading as generic sticker-wall rather than design.

**Fix (two parts):**
1. Any retained shields badges recolored to palette tokens
   (`color=`/`labelColor=` from the amber/ink identity, flat-square).
2. New bespoke stats data-art panel: 52-week contribution ridgeline built
   from real contribution data + language-mix bar + honest headline numbers,
   light/dark adaptive, in the amber identity. Regenerated daily by a GitHub
   Actions workflow (`.github/workflows/stats.yml` → `scripts/gen_stats.mjs`),
   committing only on change — the roadmap's "living content" approach, so
   numbers stay true without manual updates (Truth Law).

**Skill transfer:** per-repo "one hue each" badge coloring is an anti-pattern
worth naming explicitly next to the badge-wall anti-pattern: badges are UI
chrome and take palette tokens, not identity hues of their own. And "stats"
should default to the data-art panel approach, with raw stat-card widgets
(github-readme-stats et al.) called out as template gravity.

## Failure 4 — language-byte mix unrepresentative on a thin public corpus

**What shipped (this pass, v1 of the stats panel):** language-mix bar
aggregating real bytes across non-fork public repos: Shell 31%, TS 23%,
C++ 18%. George's verdict: "I don't code in C++ and sh that much."

**Root cause:** not forks (already filtered at `gen_stats.mjs`). The public
non-fork corpus is ~262 KB across 7 active repos, so a single 66 KB hobby
repo (`gomoku`, C++) swings the mix ~20 points, and Übersicht widget shell
code dominates the rest. Recency filters don't help (checked: last-12-month
byte mix is TS 32 / C++ 25 / Shell 23). The day-to-day work is in private
repos, so NO weighting of public language bytes can represent it. Truthful ≠
representative.

**Fix (decision: George, 2026-07-29):** removed the language bar and the
per-repo /languages fetching entirely. Right column now shows contribution
CADENCE metrics computed from the contribution graph (which includes private
activity): avg/day past year (27.3), peak week (522, Mar '26), longest
streak (78 days). Honest header: "CADENCE · ALL CONTRIBUTIONS".

**Skill transfer:** before choosing a language-mix visualization, CHECK
CORPUS SIZE AND CONCENTRATION (total bytes; share of top repo). If the top
repo exceeds ~15% of bytes or total corpus is tiny, language mix will
misrepresent the person — prefer contribution-derived metrics, which cover
private activity. Add this as a recorded constraint in the roadmap's
"contribution-graph & data art" section: truthful data can still fail the
Bespoke Law if it doesn't actually describe the person.

## Process notes for the skill (meta)

- Verification gap that let failure 1 through: renders were reviewed as
  standalone images, never composited on GitHub page chrome. → add page-chrome
  compositing to `references/visual-verification.md` gate.
- Verification gap that let failure 2 through: the live profile (pins block)
  was not part of the reviewed artifact. → post-publish check must screenshot
  the full profile page, both modes, not just the README region.
- `similarity_check.sh` remains untrustworthy under ImageMagick 7
  (thresholds pass everything) — do not use as a gate until recalibrated.

## Follow-ups discovered during verification

- Hero SVG bakes in static telemetry ("15 repos, 22 followers, 4 pinned") —
  typed constants that will drift stale. Truth Law leak from the 2026-07-22
  pass. Follow-up: extend the daily stats workflow to regenerate the hero's
  telemetry block too (or strip the numbers from the hero). **Skill transfer:**
  the Truth Law's "no typed constants" check must be applied to numbers inside
  banner/panel SVGs, not just README badges — SVG text is where stale numbers
  hide.
- `panel2` ("OUTPUT LOG — SHIPPED / VERIFIED REPOS") is a decorative header
  for the repo table being removed; dropped from the README to avoid an
  orphaned heading (asset kept on disk). **Skill transfer:** when a redesign
  removes a content block, sweep for decorative SVG panels that only exist to
  frame it.

## Applied changes (this pass)

(Filled in as work lands — see git log for the authoritative record.)

- [x] `assets/hero-light.svg`, `panel2-light.svg`, `panel3-light.svg` →
      `#ffffff` page-blend recolor, geometry identical to dark variants,
      contrast computed (title 15.6:1, amber strokes 3.1–3.9:1, muted 3.5:1+)
- [x] `assets/stats-light.svg` / `stats-dark.svg` + `scripts/gen_stats.mjs` +
      `.github/workflows/stats.yml` (daily 09:00 UTC, diff-gated commit).
      Real data at build: 10,007 contributions/yr, 41 public repos, 27 stars
      (non-fork), lang mix SH 31% / TS 23% / C++ 18% / JS 12% / CLJ 7.4%
- [x] README recomposition: hero → intro sub-line → stats panel → panel3
      (ground links). Removed: repo table + its 4 badges + panel2 header.
      Badges not relocated — stats panel carries the live numbers now
- [x] Preview rendered (`capture/preview.html`, `capture/preview-full.png`),
      both modes visually verified against white/`#0d1117` page chrome
