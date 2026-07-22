# louixs profile banner — full-replacement design pass

**Date:** 2026-07-22
**Status:** approved direction, spec for implementation planning
**Scope decision:** Full replacement search. The calibration-card identity (shipped 2026-07) was a first draft; this pass hunts for a genuinely different, eye-popping identity. Calibration-card stays live (with the interim bg fix) until a replacement wins.

## Problem

1. The live light-theme banners use `#D0D0CE` (gray-card tone) which clashes with GitHub's white page background — reads as a pasted rectangle, not a designed page.
2. The three existing style variants (ink-editorial, swiss-poster, phosphor-terminal) live in the skill's `demo/variants/` — they are demo fixtures never designed for George's taste, and he rates them "meh, not eye-popping".

## Constraints (all candidates)

- **Background rule — blend or bold:** a banner background is either an exact match for GitHub's page (`#ffffff` light / `#0d1117` dark, elements float on the page) or a committed intentional color block (poster red, deep ink). Near-miss neutrals are the only illegal move.
- Light/dark adaptive via `<picture>` sources, as the README does today.
- Real data only — language mix, pinned repos (onebreath, tsushin, ubersicht_gcal, ubersicht_gmail), live shields.io badges, the three sites (10yx.co, solvarv.com, collapsingboundaries.com). Zero fabricated claims (skill rule).
- GitHub README SVG constraints per the skill's `github-readme-constraints.md` (no external fonts, no scripts, README width).
- Quality gate: every candidate shown to George must score ≥80 on the skill's rendered rubric (`github-profile-10x` section 4). Scores recorded as the baseline quality metric for this pass.

## Step 0 — interim fix (ships immediately, independent)

- `assets/hero-light.svg`, `assets/panel2-light.svg`, `assets/panel3-light.svg`: bg `#D0D0CE` → `#ffffff`.
- Contrast check: calibration grid, tick ruler, and any light-gray strokes must still read on white; darken if they vanish.
- Verify dark variants sit correctly on `#0d1117`.
- Render + screenshot both themes before pushing.

## Phase 1 — probe round

Generate 6–8 deliberately divergent hero-banner candidates (1200×400, light + dark, real data). Anchor list (each a named tradition, nothing adjacent to the dead demo variants):

1. Japanese poster modernism (Kamekura / Yokoo)
2. Motorsport livery / telemetry data density
3. Brutalist web (massive type, raw B/W, harsh rules)
4. Cinematic HUD / technical documentary
5. Risograph overprint (2-color misregistration, grain)
6. Vignelli wayfinding / metro signage
7. –8. wildcards at implementer's discretion, subject to the same gate

Process per candidate: author SVG → render PNG at GitHub width in both themes → rubric-score → only ≥80 enters the gallery. Deliverable: a side-by-side gallery (HTML or image grid) + one-line rationale per candidate.

George reacts per candidate: **pick / "this but less X" / kill.** He may add external references at any point; references get the skill's brand-ingestion treatment and steer the next loop.

## Phase 2 — refinement loops (expect several)

George expects a few improve loops — this is the designed shape, not failure:

- Loop input: surviving direction(s) + reaction notes + any references.
- Loop output: revised candidate(s), re-rendered, re-scored, back to the gallery.
- Repeat until George picks a winner. No loop cap; kill criterion is George choosing to stop.

## Phase 3 — winner buildout

- Full README treatment: hero + panel2 + panel3 + spec-sheet composition in the winning identity.
- Light/dark adaptive, live badges kept, bg rule enforced.
- Rendered screenshots at GitHub widths, both themes, reviewed before merge.
- Probe/loop artifacts pruned; only shipped assets land on `main`.

## Working arrangement

- Branch off `main` (e.g. `design-pass`); candidates live in an uncommitted working dir (`candidates/`, gitignored) — only the winner's assets are committed.
- Rendering/screenshot tooling: reuse `capture/` conventions already in the repo.

## Measurement

One-off visual asset — falls under the planning-discipline small-scope exception. Recorded anyway: rubric scores per candidate (baseline + per-loop), rendered before/after screenshots in `capture/`. Outward impact tracking stays with the existing hand-curated marketing status table (10yx engineering-as-marketing motion); no new automation.

## Out of scope

- Changes to README prose/claims content (layout may change; facts do not).
- The skill's own `demo/variants/` fixtures (they belong to the skill repo, not louixs).
- Any new measurement infrastructure.
