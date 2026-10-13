#!/usr/bin/env node
/**
 * Generates app/dark-palette.css.
 *
 * The dashboard was authored light-only: ~1,400 hardcoded arbitrary colour
 * utilities (bg-[#E5E9EF], text-[#111827], ...) spread over 24 view files.
 * Rewriting every call site by hand would touch logic-bearing JSX and risk
 * regressions, so instead we derive a dark counterpart for each colour and
 * emit `.dark`-scoped overrides that win on specificity.
 *
 * Re-run after adding new hardcoded colours:
 *   node scripts/generate-dark-palette.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindColors from 'tailwindcss/colors.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'app', 'dark-palette.css');

/** Flattened { family: { shade: hex } } for the non-deprecated families. */
const PALETTE = Object.fromEntries(
  Object.entries(tailwindColors)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([k, v]) => [k, v]),
);

const SCAN_DIRS = [
  join(root, 'app'),
  join(root, 'components', 'app'),
  join(root, 'components', 'ui'),
  // lib/appapi.js holds PRIORITY_META and statusClass - the badge class strings
  // that drive most status colouring, including vivid fill/label pairings.
  join(root, 'lib'),
];

// ---------------------------------------------------------------- colour math

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }) {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x];
  const m = ln - c / 2;
  const to = (v) => Math.round(Math.max(0, Math.min(1, v + m)) * 255)
    .toString(16).padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Neutral greys pick up a subtle blue tint so they sit with the .dark tokens. */
const NEUTRAL_HUE = 222;

/**
 * Perceived colourfulness, 0-100, from the raw RGB spread.
 *
 * HSL saturation is unusable for classification here: near-black slate tones
 * such as #111827 report ~39% saturation yet read as neutral grey, so keying
 * off saturation turned body text blue. RGB spread stays honest at both ends
 * of the lightness range.
 */
function chromaOf({ r, g, b }) {
  return ((Math.max(r, g, b) - Math.min(r, g, b)) / 255) * 100;
}

const PURE_GREY = 4; // below this there is no hue worth preserving
const TINTED = 15; // below this the hue is a wash, not a semantic colour

function darkForSurface(hsl, chroma) {
  if (chroma <= TINTED) {
    // Surfaces use a slightly wider grey band than text: washes such as the
    // kanban column fills (#fbf8f0, chroma ~4) are meant as neutral panels.
    const grey = chroma <= 5;
    // Kept as a ladder rather than a linear inversion so the near-white values
    // the views lean on stay distinguishable: the page wash (#f7f8fc, ~98%)
    // must sit behind panels (#fff) and chips (slate-100, ~96%) rather than
    // collapsing onto the same dark tone.
    const l =
      hsl.l >= 97.5 ? 11
      : hsl.l >= 93 ? 15
      : hsl.l >= 86 ? 18
      : hsl.l >= 60 ? 22
      : hsl.l >= 40 ? 28
      : hsl.l >= 20 ? 20
      // Near-black fills are the solid primary buttons (bg-[#17171c] text-white).
      // Mapping them to the page tone made them vanish, so lift them to a
      // raised grey that still carries the white label (~8:1).
      : hsl.l >= 14 ? 35
      : 30;
    // Faintly tinted washes (kanban column fills, avatar discs) sit one step
    // above the card surface with only a hint of hue, so warm and cool washes
    // read as the same family instead of one turning brown and the rest vanishing.
    if (!grey && hsl.l >= 86) return { h: hsl.h, s: Math.min(hsl.s, 12), l: 19 };
    return { h: grey ? NEUTRAL_HUE : hsl.h, s: grey ? 16 : Math.min(hsl.s, 24), l };
  }
  // Pale tinted washes (success/warn/info panels) become deep tinted surfaces.
  if (hsl.l >= 90) return { h: hsl.h, s: Math.min(hsl.s, 46), l: 16 };
  if (hsl.l >= 78) return { h: hsl.h, s: Math.min(hsl.s, 50), l: 20 };
  if (hsl.l > 72) return { h: hsl.h, s: Math.min(hsl.s, 58), l: 26 };
  // Vivid mid-tones - brand magenta, priority badges, status fills - are left
  // exactly as authored. They already read well on a dark surface, and nudging
  // their lightness would erode the contrast of the white labels sitting on
  // them. Returning the input means no rule is emitted at all.
  if (hsl.l >= 30) return hsl;
  // Deep saturated fills (#12795a green, #0f7c86 teal) still stand out on the
  // dark surfaces and carry white labels, so lifting them only costs contrast.
  if (hsl.l >= 20) return hsl;
  return { h: hsl.h, s: Math.min(hsl.s, 80), l: clamp(hsl.l + 12, 24, 40) };
}

function darkForText(hsl, chroma) {
  if (chroma <= TINTED) {
    if (hsl.l > 85) return null; // already light — sits on a coloured fill
    const grey = chroma <= PURE_GREY;
    const l =
      hsl.l <= 22 ? 95
      : hsl.l <= 38 ? 90
      : hsl.l <= 52 ? 84
      : hsl.l <= 68 ? 74
      : 66;
    return { h: grey ? 214 : hsl.h, s: grey ? 18 : Math.min(hsl.s, 20), l };
  }
  if (hsl.l > 78) return null; // light tint on a coloured fill — leave it
  // Floors are set so the result clears WCAG AA (4.5:1) against the dark
  // surfaces above, which a straight lightness inversion does not guarantee for
  // mid-saturation reds and blues.
  if (hsl.l <= 35) return { h: hsl.h, s: Math.min(hsl.s, 80), l: clamp(hsl.l + 42, 67, 78) };
  if (hsl.l <= 55) return { h: hsl.h, s: Math.min(hsl.s, 85), l: clamp(hsl.l + 22, 67, 77) };
  return { h: hsl.h, s: Math.min(hsl.s, 90), l: clamp(hsl.l + 10, 67, 82) };
}

function darkForBorder(hsl, chroma) {
  if (chroma <= TINTED) {
    const grey = chroma <= PURE_GREY;
    const l =
      hsl.l >= 92 ? 21
      : hsl.l >= 84 ? 24
      : hsl.l >= 70 ? 27
      : hsl.l >= 45 ? 32
      : 28;
    return { h: grey ? NEUTRAL_HUE : hsl.h, s: grey ? 14 : Math.min(hsl.s, 18), l };
  }
  if (hsl.l >= 85) return { h: hsl.h, s: Math.min(hsl.s, 40), l: 25 };
  if (hsl.l >= 70) return { h: hsl.h, s: Math.min(hsl.s, 55), l: 32 };
  // Vivid borders pair with vivid fills, so leave them untouched too.
  if (hsl.l >= 30) return hsl;
  return { h: hsl.h, s: Math.min(hsl.s, 80), l: clamp(hsl.l + 14, 32, 55) };
}

/** Which CSS property each Tailwind utility prefix drives. */
const UTILITIES = {
  bg: { props: ['background-color'], derive: darkForSurface },
  from: { props: ['--tw-gradient-from'], derive: darkForSurface, gradient: 'from' },
  via: { props: ['--tw-gradient-to'], derive: darkForSurface, gradient: 'via' },
  to: { props: ['--tw-gradient-to'], derive: darkForSurface, gradient: 'to' },
  text: { props: ['color'], derive: darkForText },
  decoration: { props: ['text-decoration-color'], derive: darkForBorder },
  border: { props: ['border-color'], derive: darkForBorder },
  divide: { props: ['border-color'], derive: darkForBorder },
  ring: { props: ['--tw-ring-color'], derive: darkForBorder },
};

/**
 * Variant prefix -> full selector builder.
 *
 * Each builder receives the already-escaped class selector (e.g.
 * `.hover\:bg-\[\#1C2836\]`) and returns the complete rule selector. The
 * `.dark` scope must always lead, because next-themes puts that class on
 * <html>: a naive `.group:hover .dark .x` would require <html> to sit inside
 * the group and never match.
 */
const VARIANTS = {
  hover: (cls) => `.dark ${cls}:hover`,
  focus: (cls) => `.dark ${cls}:focus`,
  'focus-visible': (cls) => `.dark ${cls}:focus-visible`,
  'focus-within': (cls) => `.dark ${cls}:focus-within`,
  active: (cls) => `.dark ${cls}:active`,
  disabled: (cls) => `.dark ${cls}:disabled`,
  'group-hover': (cls) => `.dark .group:hover ${cls}`,
  'group-focus': (cls) => `.dark .group:focus ${cls}`,
  'peer-hover': (cls) => `.dark .peer:hover ~ ${cls}`,
  'peer-focus': (cls) => `.dark .peer:focus ~ ${cls}`,
};

// ------------------------------------------------------------------- scanning

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(js|jsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const files = SCAN_DIRS.filter((d) => {
  try { return statSync(d).isDirectory(); } catch { return false; }
}).flatMap((d) => walk(d));

const utilNames = Object.keys(UTILITIES).join('|');
const variantNames = Object.keys(VARIANTS)
  .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

/** Tailwind palette families we resolve by name. white/black are handled by
 *  hand in globals.css: `bg-white` must flip to a dark surface while
 *  `text-white` has to stay white on top of coloured fills. */
const PALETTES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber',
  'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue',
  'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Matches `bg-[#fff]`, `hover:bg-[#fff]`, `text-red-800`, `hover:bg-slate-100`.
// A trailing opacity modifier disqualifies the match so Tailwind's own
// rgb(... / alpha) output is left alone.
const CLASS_RE = new RegExp(
  String.raw`(?:^|[\s"'\`{}():])(` +
    String.raw`(?:(?:${variantNames}):)?(?:${utilNames})-` +
    String.raw`(?:\[#[0-9A-Fa-f]{3,8}\]|(?:${PALETTES.join('|')})-(?:${SHADES.join('|')}))` +
    String.raw`)(?![\w[\]#/.-])`,
  'g',
);

/** Strict forms so `text-[12.5px]`, `text-[var(--x)]` and opacity-suffixed
 *  classes like `bg-[#ED00ED]/10` are rejected rather than parsed as colours. */
const ARBITRARY_FORM = /^(.+?)-\[#([0-9A-Fa-f]{3,8})\]$/;
const PALETTE_FORM = /^(.+?)-([a-z]+)-(\d{2,3})$/;

/** token -> { variant, util, hex } or null when the colour cannot be resolved. */
function resolveToken(cls) {
  const parts = cls.split(':');
  const bare = parts.pop();
  const variant = parts.join(':') || null;
  if (variant && !VARIANTS[variant]) return null;

  let util;
  let hex;
  const arbitrary = ARBITRARY_FORM.exec(bare);
  if (arbitrary) {
    util = arbitrary[1];
    hex = `#${arbitrary[2]}`;
  } else {
    const palette = PALETTE_FORM.exec(bare);
    if (!palette) return null;
    util = palette[1];
    hex = PALETTE[palette[2]]?.[palette[3]];
  }
  if (!util || !UTILITIES[util]) return null;
  if (typeof hex !== 'string' || !/^#[0-9A-Fa-f]{3,8}$/.test(hex)) return null;
  return { variant, util, hex };
}

/** class string -> resolved descriptor */
const found = new Map();
/** class-attribute token sets, used to spot vivid fill + dark text pairings */
const tokenGroups = [];
const STRING_RE = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(CLASS_RE)) {
    const cls = m[1];
    if (found.has(cls)) continue;
    const resolved = resolveToken(cls);
    if (resolved) found.set(cls, resolved);
  }
  // Collect co-located classes so a badge's fill and label can be compared.
  for (const s of src.matchAll(STRING_RE)) {
    const tokens = s[2]
      .split(/[\s${}]+/)
      .filter((t) => /^[a-z-]*:?(?:bg|text|border)-/.test(t));
    if (tokens.length > 1) tokenGroups.push(tokens);
  }
}

// ------------------------------------------------------------------ emit CSS

const escapeClass = (cls) => cls.replace(/([:[\]#/.%,()])/g, '\\$1');

const rules = [];
let skipped = 0;

/** True when darkForSurface leaves a fill essentially as-authored, i.e. it is a
 *  vivid badge/button colour rather than a pale wash that becomes a dark
 *  surface. Checked against the derived value so it cannot drift from the
 *  branch logic in darkForSurface. */
function keepsFill(hex) {
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb);
  const chroma = chromaOf(rgb);
  if (chroma <= TINTED) return false;
  const derived = darkForSurface(hsl, chroma);
  return Math.abs(derived.l - hsl.l) <= 6 && derived.l >= 30;
}

for (const [cls, { variant, util, hex }] of [...found.entries()].sort((a, b) =>
  a[0].localeCompare(b[0]),
)) {
  const spec = UTILITIES[util];
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb);
  const target = spec.derive(hsl, chromaOf(rgb));
  if (!target) { skipped += 1; continue; }
  const value = hslToHex(target);
  if (value.toLowerCase() === hex.toLowerCase()) { skipped += 1; continue; }

  const escaped = `.${escapeClass(cls)}`;
  const selector = variant
    ? VARIANTS[variant](escaped)
    : `.dark ${escaped}`;

  const decls = [];
  if (spec.gradient === 'from') {
    decls.push(`--tw-gradient-from: ${value} var(--tw-gradient-from-position)`);
    decls.push(
      '--tw-gradient-to: rgb(255 255 255 / 0) var(--tw-gradient-to-position)',
    );
    decls.push(
      '--tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to)',
    );
  } else if (spec.gradient === 'via') {
    decls.push(
      '--tw-gradient-to: rgb(255 255 255 / 0) var(--tw-gradient-to-position)',
    );
    decls.push(
      `--tw-gradient-stops: var(--tw-gradient-from), ${value} var(--tw-gradient-via-position), var(--tw-gradient-to)`,
    );
  } else if (spec.gradient === 'to') {
    decls.push(`--tw-gradient-to: ${value} var(--tw-gradient-to-position)`);
  } else {
    for (const prop of spec.props) decls.push(`${prop}: ${value}`);
  }

  rules.push(`${selector} {\n  ${decls.join(';\n  ')};\n}`);
}

// ------------------------------------------------- vivid fill pairing restores
//
// A badge like `bg-yellow-400 text-yellow-950` keeps its bright fill in dark
// mode, so lightening the label would leave pale text on a pale fill. Where a
// kept fill and a would-be-lightened label appear on the same element, restore
// the authored label colour at higher specificity (0,3,0 beats the 0,2,0 base).
const restores = new Map();
for (const tokens of tokenGroups) {
  const fills = [];
  const labels = [];
  for (const token of tokens) {
    const resolved = resolveToken(token);
    if (!resolved || resolved.variant) continue;
    if (resolved.util === 'bg' && keepsFill(resolved.hex)) fills.push(token);
    if (resolved.util === 'text') labels.push({ token, hex: resolved.hex });
  }
  if (!fills.length || !labels.length) continue;
  for (const fill of fills) {
    for (const { token, hex } of labels) {
      const rgb = hexToRgb(hex);
      const derived = darkForText(rgbToHsl(rgb), chromaOf(rgb));
      if (!derived) continue; // already left alone
      const key = `${fill}|${token}`;
      if (restores.has(key)) continue;
      restores.set(
        key,
        `.dark .${escapeClass(fill)}.${escapeClass(token)} {\n  color: ${hex};\n}`,
      );
    }
  }
}

const restoreRules = [...restores.values()].sort();

// ------------------------------------------------- opacity-modified utilities
//
// `bg-[#f5f5f2]/90` compiles to rgb(... / 0.9), which the class pass above
// skips. Re-emit it with the derived dark colour at the same alpha.
const OPACITY_RE = /(?:^|[\s"'`{}():])((?:bg|border|text)-\[#([0-9A-Fa-f]{3,8})\]\/(\d{1,3}))(?![\w[\]#/.-])/g;
const opacityRules = new Map();
for (const file of files) {
  for (const m of readFileSync(file, 'utf8').matchAll(OPACITY_RE)) {
    const [, cls, hex, pct] = m;
    if (opacityRules.has(cls)) continue;
    const util = cls.split('-')[0];
    const spec = UTILITIES[util];
    const rgb = hexToRgb(`#${hex}`);
    const target = spec.derive(rgbToHsl(rgb), chromaOf(rgb));
    if (!target) continue;
    const value = hslToHex(target);
    if (value.toLowerCase() === `#${hex}`.toLowerCase()) continue;
    const d = hexToRgb(value);
    opacityRules.set(cls, `.dark .${escapeClass(cls)} {\n  ${spec.props[0]}: rgb(${d.r} ${d.g} ${d.b} / ${Number(pct) / 100});\n}`);
  }
}

// ------------------------------------------------------- inline style colours
//
// Many views colour elements through `style={{ background: X, color: Y }}`
// with hex constants (status tones, chart tracks, KPI values). Utilities can't
// reach those, so match the browser's serialised style attribute instead -
// Chrome/Firefox/Safari all write `color: rgb(r, g, b)` - and override with
// !important. Same derivations as the class pass, so both paths agree.
// SVG presentation attributes (fill="#..", stroke="#..") are matched directly.
const HEX_LITERAL_RE = /(["'`])#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\1/g;
const inlineHexes = new Set();
for (const file of files) {
  for (const m of readFileSync(file, 'utf8').matchAll(HEX_LITERAL_RE)) {
    let h = m[2].toLowerCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    inlineHexes.add(`#${h}`);
  }
}
const rgbText = (hex) => { const { r, g, b } = hexToRgb(hex); return `rgb(${r}, ${g}, ${b})`; };
const derived = (fn, hex) => {
  const rgb = hexToRgb(hex);
  const t = fn(rgbToHsl(rgb), chromaOf(rgb));
  if (!t) return null;
  const v = hslToHex(t);
  return v.toLowerCase() === hex ? null : v;
};
const inlineRules = [];
const darkTexts = [];
for (const hex of [...inlineHexes].sort()) {
  const c = rgbText(hex);
  const text = derived(darkForText, hex);
  const surface = derived(darkForSurface, hex);
  const border = derived(darkForBorder, hex);
  if (text) {
    inlineRules.push(`.dark [style^="color: ${c}"],\n.dark [style*="; color: ${c}"],\n.dark text[fill="${hex}" i],\n.dark tspan[fill="${hex}" i] {\n  color: ${text} !important;\n  fill: ${text};\n}`);
    inlineRules.push(`.dark [style*="outline: ${c}"] {\n  outline-color: ${text} !important;\n}`);
    const rgb = hexToRgb(hex);
    if (chromaOf(rgb) <= TINTED && rgbToHsl(rgb).l <= 40) darkTexts.push(c);
  }
  if (surface) {
    inlineRules.push(`.dark [style*="background: ${c}"],\n.dark [style*="background-color: ${c}"] {\n  background-color: ${surface} !important;\n}`);
    inlineRules.push(`.dark rect[fill="${hex}" i],\n.dark path[fill="${hex}" i],\n.dark circle[fill="${hex}" i] {\n  fill: ${surface};\n}`);
  }
  if (border) {
    inlineRules.push(`.dark [style*="border-color: ${c}"],\n.dark [style*="solid ${c}"] {\n  border-color: ${border} !important;\n}`);
    inlineRules.push(`.dark [stroke="${hex}" i] {\n  stroke: ${border};\n}`);
  }
}
// A vivid inline fill (kept as authored) with dark inline text on it keeps its
// authored label colour; 0,3,0 outranks the 0,2,0 text override above. Pairs
// come from fill and label literals that sit on the same source line (tone
// tables such as `["Pending", "#e0b44a", "#17171c"]`).
const darkTextSet = new Set(darkTexts);
const pairs = new Set();
for (const file of files) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const hexes = [...line.matchAll(HEX_LITERAL_RE)].map((m) => {
      let h = m[2].toLowerCase();
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      return `#${h}`;
    });
    const fills = hexes.filter(keepsFill);
    const labels = hexes.filter((h) => darkTextSet.has(rgbText(h)));
    for (const f of fills) for (const t of labels) pairs.add(`${f}|${t}`);
  }
}
for (const pair of [...pairs].sort()) {
  const [f, t] = pair.split('|');
  const fc = rgbText(f);
  const tc = rgbText(t);
  inlineRules.push(`.dark [style*="background: ${fc}"]:is([style^="color: ${tc}"], [style*="; color: ${tc}"]),\n.dark [style*="background-color: ${fc}"]:is([style^="color: ${tc}"], [style*="; color: ${tc}"]) {\n  color: ${t} !important;\n}`);
}

const header = `/*
 * GENERATED FILE - do not edit by hand.
 * Source: scripts/generate-dark-palette.mjs
 *
 * Dark-mode counterparts for the colour utilities used across the dashboard
 * views, covering both hardcoded arbitrary values (bg-[#E5E9EF]) and the
 * standard Tailwind palette (text-purple-800). Every rule is scoped to .dark so
 * light mode is byte-for-byte unchanged, and every override only alters colour -
 * never layout, spacing or behaviour.
 *
 * Scanned ${files.length} files - ${found.size} colour utilities
 * ${rules.length} overrides + ${restoreRules.length} vivid-fill restores.
 */
`;

const body = [
  rules.join('\n\n'),
  restoreRules.length
    ? `\n/* Vivid fills keep their authored label colour. */\n\n${restoreRules.join('\n\n')}`
    : '',
  opacityRules.size
    ? `\n/* Opacity-modified utilities (bg-[#hex]/90). */\n\n${[...opacityRules.values()].join('\n\n')}`
    : '',
  inlineRules.length
    ? `\n/* Inline style={{}} colours and SVG fill/stroke attributes. */\n\n${inlineRules.join('\n\n')}`
    : '',
]
  .filter(Boolean)
  .join('\n');

writeFileSync(OUT, `${header}\n${body}\n`, 'utf8');

console.log(
  `dark-palette: scanned ${files.length} files, matched ${found.size} utilities, ` +
    `wrote ${rules.length} overrides + ${restoreRules.length} restores + ${opacityRules.size} opacity + ${inlineRules.length} inline ` +
    `(${skipped} intentionally unchanged)`,
);
console.log(`  -> ${relative(root, OUT)}`);
