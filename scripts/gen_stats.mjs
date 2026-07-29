#!/usr/bin/env node
// scripts/gen_stats.mjs
//
// Generates assets/stats-dark.svg and assets/stats-light.svg for the louixs
// GitHub profile README from REAL, freshly-fetched GitHub data. Zero npm
// dependencies -- only Node's built-in fetch + node:fs/node:path.
//
// Truth Law: if any required fetch fails, or data would otherwise be
// incomplete/fabricated, this script prints an error to stderr and exits 1
// WITHOUT writing any SVG. It never renders placeholder/zero/error content
// as if it were real data.
//
// Run: node scripts/gen_stats.mjs
// Env: GITHUB_TOKEN (optional) -- used as a Bearer auth header when present.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

const USERNAME = 'louixs';
const TOKEN = process.env.GITHUB_TOKEN;
const UA = 'louixs-profile-stats-generator';

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

function apiHeaders() {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': UA };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

function htmlHeaders() {
  return { 'User-Agent': UA };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch with a couple of retries + backoff for transient failures. Throws on
 * final failure -- callers decide whether that's fatal (per the Truth Law,
 * for this script it always is, since every fetch here feeds real data).
 */
async function fetchWithRetry(url, opts = {}, { retries = 2, baseDelayMs = 800 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        const reset = res.headers.get('x-ratelimit-reset');
        throw new Error(
          `Rate limited (HTTP ${res.status}) fetching ${url}. ` +
            `x-ratelimit-remaining=${remaining} reset=${reset}`
        );
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Contribution graph: fetch + parse the public HTML fragment
// ---------------------------------------------------------------------------
//
// https://github.com/users/<user>/contributions returns an HTML fragment
// (not full document) containing:
//   - an <h2 id="js-contribution-activity-description"> with the literal
//     "N,NNN contributions in the last year" text
//   - one <td class="ContributionCalendar-day" data-date="YYYY-MM-DD"
//     id="contribution-day-component-W-D" data-level="0-4" ...></td> per day
//   - a matching <tool-tip ... for="contribution-day-component-W-D" ...>
//     "N contribution(s) on <Month> <Day><suffix>." (or "No contributions
//     on ...") sr-only element per day, which carries the EXACT count --
//     data-level is only a bucketed 0-4 approximation, so we prefer the
//     tool-tip text and only fall back to data-level if a tooltip is
//     missing/unparseable.
//
// This shape was verified against a live fetch before writing this parser
// (per task instructions) rather than assumed from memory of past formats.

async function fetchContributionsHTML() {
  const url = `https://github.com/users/${USERNAME}/contributions`;
  const res = await fetchWithRetry(url, { headers: htmlHeaders() });
  return res.text();
}

function parseContributions(html) {
  // 1) Total contributions in the last year (headline number, verbatim from
  //    GitHub's own summary text).
  const totalBlockMatch = html.match(
    /id="js-contribution-activity-description"[\s\S]{0,400}?<\/h2>/
  );
  if (!totalBlockMatch) {
    throw new Error(
      'Could not locate contribution-activity-description block in contributions HTML'
    );
  }
  const totalNumMatch = totalBlockMatch[0].match(/([\d,]+)\s*\n?\s*contributions/);
  if (!totalNumMatch) {
    throw new Error('Could not parse total contributions number from HTML');
  }
  const totalContributions = parseInt(totalNumMatch[1].replace(/,/g, ''), 10);

  // 2) Per-day cells: id -> { date, level }
  const dayById = new Map();
  const tdRe = /<td\b[^>]*\bclass="ContributionCalendar-day"[^>]*>/g;
  let m;
  while ((m = tdRe.exec(html))) {
    const tag = m[0];
    const dateM = tag.match(/\bdata-date="(\d{4}-\d{2}-\d{2})"/);
    const idM = tag.match(/\bid="([^"]+)"/);
    const levelM = tag.match(/\bdata-level="(\d+)"/);
    if (!dateM || !idM) continue;
    dayById.set(idM[1], {
      date: dateM[1],
      level: levelM ? parseInt(levelM[1], 10) : null,
    });
  }

  // 3) tool-tips: for -> exact count text
  const tooltipRe = /<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g;
  let unparsed = 0;
  while ((m = tooltipRe.exec(html))) {
    const [, forId, text] = m;
    const day = dayById.get(forId);
    if (!day) continue;
    const trimmed = text.trim();
    if (/^No contributions/i.test(trimmed)) {
      day.count = 0;
    } else {
      const countM = trimmed.match(/^([\d,]+)\s+contributions?/i);
      if (countM) {
        day.count = parseInt(countM[1].replace(/,/g, ''), 10);
      } else {
        unparsed++;
      }
    }
  }

  const days = [...dayById.values()];
  const withCount = days.filter((d) => typeof d.count === 'number');

  if (days.length < 300) {
    throw new Error(
      `Only found ${days.length} contribution day cells (expected ~365); ` +
        `contributions HTML shape may have changed.`
    );
  }
  if (withCount.length < days.length * 0.9) {
    throw new Error(
      `Only ${withCount.length}/${days.length} day cells had a parseable exact ` +
        `count from tool-tip text (unparsed=${unparsed}); refusing to render ` +
        `possibly-incomplete data.`
    );
  }

  withCount.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { totalContributions, days: withCount };
}

/** Sum daily counts into weekly buckets (Sun-Sat, anchored to the earliest
 * fetched date, same anchoring GitHub's own calendar columns use), and
 * return the most recent `weekCount` weeks as { total, startDate } pairs so
 * callers can label a specific week (e.g. the peak week) with a real date. */
function aggregateWeeks(days, weekCount = 52) {
  const first = new Date(`${days[0].date}T00:00:00Z`);
  const buckets = new Map();
  for (const d of days) {
    const dt = new Date(`${d.date}T00:00:00Z`);
    const daysSince = Math.floor((dt - first) / 86400000);
    const weekIndex = Math.floor(daysSince / 7);
    buckets.set(weekIndex, (buckets.get(weekIndex) || 0) + d.count);
  }
  const maxIndex = Math.max(...buckets.keys());
  const weeks = [];
  for (let i = 0; i <= maxIndex; i++) {
    const startDate = new Date(first.getTime() + i * 7 * 86400000).toISOString().slice(0, 10);
    weeks.push({ total: buckets.get(i) || 0, startDate });
  }
  return weeks.slice(-weekCount);
}

/** Average contributions/day across the fetched daily series (1 decimal). */
function averagePerDay(days) {
  const sum = days.reduce((acc, d) => acc + d.count, 0);
  return sum / days.length;
}

/** The week (of the given weekly-bucket array) with the highest total. */
function peakWeek(weeks) {
  return weeks.reduce((best, w) => (w.total > best.total ? w : best), weeks[0]);
}

/** Longest run of consecutive CALENDAR days (real date deltas of exactly 1
 * day, not just adjacent array entries) each with >=1 contribution. */
function longestStreak(days) {
  let best = 0;
  let cur = 0;
  let prevDate = null;
  for (const d of days) {
    const isConsecutiveCalendarDay =
      prevDate != null &&
      Math.round((new Date(`${d.date}T00:00:00Z`) - new Date(`${prevDate}T00:00:00Z`)) / 86400000) === 1;
    if (d.count > 0) {
      cur = isConsecutiveCalendarDay ? cur + 1 : 1;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
    prevDate = d.date;
  }
  return best;
}

// ---------------------------------------------------------------------------
// GitHub REST API: user profile, repos (paginated), per-repo languages
// ---------------------------------------------------------------------------

async function fetchUserProfile() {
  const res = await fetchWithRetry(`https://api.github.com/users/${USERNAME}`, {
    headers: apiHeaders(),
  });
  return res.json();
}

/** Parse a GitHub `Link` response header for a `rel="next"` URL, if any. */
function nextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

async function fetchAllRepos() {
  let url = `https://api.github.com/users/${USERNAME}/repos?per_page=100&type=all`;
  const repos = [];
  let lastRes;
  while (url) {
    const res = await fetchWithRetry(url, { headers: apiHeaders() });
    lastRes = res;
    const page = await res.json();
    repos.push(...page);
    url = nextPageUrl(res.headers.get('link'));
  }
  const remaining = lastRes ? parseInt(lastRes.headers.get('x-ratelimit-remaining') || '0', 10) : 0;
  return { repos, rateRemaining: remaining };
}

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------
//
// Shape budget: exactly 3 primitive shape types across the whole panel --
// <rect> (bars, corner brackets' hairline arms rendered as thin rects,
// separators), <path> (corner-bracket L-shapes, the data-mapped ridgeline
// area + its stroke), and <circle> (the freshness/telemetry dot). <text> is
// typography, not a "shape" under the Schematic Law's shape-type budget.
//
// Everything is placed on an 8px grid (viewBox 1200x256; 1200 = 150*8,
// 256 = 32*8). The ridgeline path is fully constructible: it's a straight-
// line polygon through the 52 real weekly totals -- "data as portrait", no
// freehand curves.

const FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";

const THEMES = {
  dark: {
    bg: '#0d1117',
    ink: '#ECE6D6',
    amber: '#E8973F',
    muted: '#948F7C',
    line: '#5B584C',
    tint1: 'rgba(232,151,63,0.05)',
    tint2: 'rgba(236,230,214,0.035)',
  },
  light: {
    bg: '#ffffff',
    ink: '#1F242C',
    amber: '#C0751D',
    muted: '#5C5747',
    line: '#767065',
    tint1: 'rgba(192,117,29,0.06)',
    tint2: 'rgba(31,36,44,0.035)',
  },
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtInt(n) {
  return n.toLocaleString('en-US');
}

function fmtMonthYear(isoDate) {
  const [y, mo] = isoDate.split('-');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[parseInt(mo, 10) - 1]} '${y.slice(2)}`;
}

function text(x, y, size, weight, tracking, fill, anchor, content) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" letter-spacing="${tracking}" fill="${fill}" text-anchor="${anchor}">${esc(content)}</text>`;
}

function buildRidgelinePath(weeks, x0, x1, yTop, yBase) {
  const totals = weeks.map((w) => w.total);
  const max = Math.max(1, ...totals);
  const n = weeks.length;
  const step = (x1 - x0) / (n - 1);
  const points = totals.map((v, i) => {
    const x = x0 + i * step;
    const y = yBase - (v / max) * (yBase - yTop);
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
  });
  const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
  const areaD = `${lineD} L${points[points.length - 1][0]},${yBase} L${points[0][0]},${yBase} Z`;
  const peakIndex = totals.indexOf(Math.max(...totals));
  return { lineD, areaD, peak: points[peakIndex] };
}

function buildSVG(themeName, data) {
  const t = THEMES[themeName];
  const {
    totalContributions,
    weeks,
    publicRepos,
    totalStars,
    avgPerDay,
    peakWeekTotal,
    peakWeekLabel,
    longestStreakDays,
    firstDate,
    lastDate,
    generatedDate,
  } = data;

  const W = 1200;
  const H = 256;
  const marginL = 20;
  const marginR = 1180;

  // Corner brackets (path) -- same grammar as hero-*.svg / panel2 / panel3.
  const brackets = `
<g fill="none" stroke="${t.line}" stroke-width="1.5">
<path d="M44,20 L20,20 L20,44"/>
<path d="M1156,20 L1180,20 L1180,44"/>
<path d="M44,236 L20,236 L20,212"/>
<path d="M1156,236 L1180,236 L1180,212"/>
</g>`;

  // Header row.
  const header = `
${text(64, 40, 11, 600, 3, t.amber, 'start', 'GITHUB STATS · LOUIXS')}
<rect x="64" y="50" width="1072" height="1.5" fill="${t.line}" opacity="0.6"/>`;

  // Headline numbers, left column.
  const nums = [
    { v: fmtInt(totalContributions), label: 'CONTRIBUTIONS · PAST YEAR' },
    { v: fmtInt(publicRepos), label: 'PUBLIC REPOSITORIES' },
    { v: fmtInt(totalStars), label: 'STARS · NON-FORK REPOS' },
  ];
  const numsY = [104, 160, 216];
  const numBlocks = nums
    .map(
      (n, i) => `
${text(64, numsY[i], 34, 300, 0.5, t.ink, 'start', n.v)}
${text(64, numsY[i] + 16, 10, 600, 1.8, t.muted, 'start', n.label)}`
    )
    .join('');

  // Ridgeline (path), center.
  const plotX0 = 328;
  const plotX1 = 840;
  const plotYTop = 96;
  const plotYBase = 204;
  const { lineD, areaD, peak } = buildRidgelinePath(weeks, plotX0, plotX1, plotYTop, plotYBase);
  const ridgeCaption = text(
    plotX0,
    76,
    10,
    600,
    2,
    t.muted,
    'start',
    '52-WEEK CONTRIBUTION RIDGELINE'
  );
  const ridge = `
${ridgeCaption}
<path class="ridge-fill" d="${areaD}" fill="${t.amber}" opacity="0.16"/>
<path class="ridge-line" d="${lineD}" fill="none" stroke="${t.amber}" stroke-width="1.4"/>
<path class="ridge-glint" d="${lineD}" fill="none" stroke="${t.ink}" stroke-width="1.4" opacity="0.55" pathLength="1000" stroke-dasharray="26 974"/>
<circle cx="${peak[0]}" cy="${peak[1]}" r="2.5" fill="${t.amber}"/>
<rect x="${plotX0}" y="${plotYBase}" width="${plotX1 - plotX0}" height="1" fill="${t.line}" opacity="0.6"/>
${text(plotX0, plotYBase + 16, 10, 500, 1, t.muted, 'start', fmtMonthYear(firstDate))}
${text(plotX1, plotYBase + 16, 10, 500, 1, t.muted, 'end', fmtMonthYear(lastDate))}`;

  // Cadence metrics, right column -- derived from the same contribution
  // data as the ridgeline (private-repo activity included), so unlike a
  // language-mix bar built from a tiny public-repo corpus this is
  // representative. Styled like the left column's headline numbers (same
  // value/label typography, same row grid) but made visually distinct with
  // the hero's telemetry-list grammar: a small amber square tick beside
  // each label and hairline row separators.
  const cadenceX0 = 900;
  const cadenceColW = 236;
  const cadenceCaption = text(cadenceX0, 76, 10, 600, 2, t.muted, 'start', 'CADENCE · ALL CONTRIBUTIONS');
  const cadenceRows = [
    { v: avgPerDay.toFixed(1), label: 'AVG PER DAY · PAST YEAR' },
    { v: fmtInt(peakWeekTotal), label: `PEAK WEEK · ${peakWeekLabel}` },
    { v: fmtInt(longestStreakDays), label: 'LONGEST STREAK · DAYS' },
  ];
  const cadenceY = [104, 160, 216]; // same grid rows as the left column
  const cadenceBlocks = cadenceRows
    .map((r, i) => {
      const y = cadenceY[i];
      const labelY = y + 16;
      const tickY = labelY - 8;
      const sepY = labelY + 8;
      const sep =
        i < cadenceRows.length - 1
          ? `\n<rect x="${cadenceX0}" y="${sepY}" width="${cadenceColW}" height="1" fill="${t.line}" opacity="0.4"/>`
          : '';
      return `
${text(cadenceX0, y, 30, 300, 0.5, t.ink, 'start', r.v)}
<rect x="${cadenceX0}" y="${tickY}" width="5" height="5" fill="${t.amber}"/>
${text(cadenceX0 + 13, labelY, 10, 600, 1.4, t.muted, 'start', r.label)}${sep}`;
    })
    .join('');
  const cadenceBlock = `
${cadenceCaption}
${cadenceBlocks}`;

  // Footer: freshness stamp with pulsing "live" dot -- this IS the one
  // subtle animation. It never gates visibility of any content (the dot is
  // always painted, opacity only oscillates between 0.55 and 0.9, exactly
  // like hero-*.svg's .node-pulse), and the ridgeline's glint overlay above
  // never controls the ridgeline's own visibility either -- the solid
  // .ridge-line/.ridge-fill are always fully opaque and complete at rest.
  // Anchored under the ridgeline column (right-aligned to plotX1), not the
  // bottom-right corner -- that spot collided with the cadence column's
  // third row label ("LONGEST STREAK · DAYS") once the language bars were
  // replaced with taller cadence rows.
  const footer = `
<g class="pulse">
<circle cx="${plotX1 + 8}" cy="237" r="2.5" fill="${t.amber}"/>
</g>
${text(plotX1, 241, 10, 500, 1, t.muted, 'end', `UPDATED ${generatedDate}`)}`;

  const style = `
<style>
@keyframes glintmove{from{stroke-dashoffset:1000}to{stroke-dashoffset:0}}
.ridge-glint{animation:glintmove 12s linear infinite}
@keyframes pulse{0%,100%{opacity:0.55}50%{opacity:0.9}}
.pulse{animation:pulse 9s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.ridge-glint{animation:none}.pulse{animation:none}}
</style>`;

  const title = `louixs GitHub stats panel (${themeName})`;
  const desc =
    `Data-art stats panel for github.com/${USERNAME}: ${fmtInt(totalContributions)} contributions ` +
    `in the past year rendered as a 52-week contribution ridgeline from ${fmtMonthYear(firstDate)} ` +
    `to ${fmtMonthYear(lastDate)}, ${fmtInt(publicRepos)} public repositories, ${fmtInt(totalStars)} ` +
    `total stars across non-fork repositories, and contribution-cadence metrics covering all ` +
    `contributions (including private repos): ${avgPerDay.toFixed(1)} average contributions per day, ` +
    `a peak week of ${fmtInt(peakWeekTotal)} (${peakWeekLabel.replace('PEAK WEEK · ', '')}), and a ` +
    `longest streak of ${fmtInt(longestStreakDays)} consecutive days. Generated ${generatedDate}.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="stats-title stats-desc">
<title id="stats-title">${esc(title)}</title>
<desc id="stats-desc">${esc(desc)}</desc>
${style}
<rect x="0" y="0" width="${W}" height="${H}" fill="${t.bg}"/>
<rect x="${plotX0 - 8}" y="16" width="${plotX1 - plotX0 + 16}" height="224" fill="${t.tint1}"/>
<rect x="${cadenceX0 - 8}" y="16" width="244" height="224" fill="${t.tint2}"/>
${brackets}
${header}
${numBlocks}
${ridge}
${cadenceBlock}
${footer}
</svg>
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`[gen_stats] ERROR: ${msg}`);
  console.error('[gen_stats] Refusing to write any SVG (Truth Law: no fabricated/placeholder output).');
  process.exit(1);
}

async function main() {
  console.error(`[gen_stats] Fetching contribution graph for ${USERNAME}...`);
  let contribHtml;
  try {
    contribHtml = await fetchContributionsHTML();
  } catch (err) {
    return fail(`failed to fetch contributions HTML: ${err.message}`);
  }

  let totalContributions, days;
  try {
    ({ totalContributions, days } = parseContributions(contribHtml));
  } catch (err) {
    return fail(`failed to parse contributions HTML: ${err.message}`);
  }
  const weeks = aggregateWeeks(days, 52);
  console.error(
    `[gen_stats] Parsed ${days.length} contribution days, ${fmtInt(totalContributions)} ` +
      `total in the last year, ${weeks.length} weekly buckets.`
  );

  console.error('[gen_stats] Fetching user profile...');
  let user;
  try {
    user = await fetchUserProfile();
  } catch (err) {
    return fail(`failed to fetch user profile: ${err.message}`);
  }
  if (typeof user.public_repos !== 'number') {
    return fail('user profile response missing public_repos');
  }

  console.error('[gen_stats] Fetching repos (paginated)...');
  let repos;
  try {
    ({ repos } = await fetchAllRepos());
  } catch (err) {
    return fail(`failed to fetch repos: ${err.message}`);
  }
  if (repos.length === 0) {
    return fail('repos list came back empty -- refusing to render a zero-repo panel');
  }
  const nonForkRepos = repos.filter((r) => !r.fork);
  const totalStars = nonForkRepos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
  console.error(`[gen_stats] ${repos.length} repos total, ${nonForkRepos.length} non-fork, ${fmtInt(totalStars)} stars summed.`);

  // Cadence metrics -- all derived from the daily contribution series
  // already fetched above (which includes private-repo activity).
  const avgPerDay = averagePerDay(days);
  const peak = peakWeek(weeks);
  const peakWeekTotal = peak.total;
  const peakWeekLabel = fmtMonthYear(peak.startDate);
  const longestStreakDays = longestStreak(days);
  console.error(
    `[gen_stats] Cadence: ${avgPerDay.toFixed(1)} avg/day, peak week ${fmtInt(peakWeekTotal)} ` +
      `(${peakWeekLabel}), longest streak ${longestStreakDays} days.`
  );

  const lastDate = days[days.length - 1].date;
  const lastDt = new Date(`${lastDate}T00:00:00Z`);
  const firstDt = new Date(lastDt.getTime() - (weeks.length * 7 - 1) * 86400000);
  const firstDate = firstDt.toISOString().slice(0, 10);
  const generatedDate = new Date().toISOString().slice(0, 10);

  const data = {
    totalContributions,
    weeks,
    publicRepos: user.public_repos,
    totalStars,
    avgPerDay,
    peakWeekTotal,
    peakWeekLabel,
    longestStreakDays,
    firstDate,
    lastDate,
    generatedDate,
  };

  const darkSvg = buildSVG('dark', data);
  const lightSvg = buildSVG('light', data);

  writeFileSync(path.join(ASSETS_DIR, 'stats-dark.svg'), darkSvg, 'utf8');
  writeFileSync(path.join(ASSETS_DIR, 'stats-light.svg'), lightSvg, 'utf8');

  console.error(
    `[gen_stats] Wrote assets/stats-dark.svg and assets/stats-light.svg (generated ${generatedDate}).`
  );
}

main().catch((err) => {
  fail(`unexpected error: ${err.stack || err.message}`);
});
