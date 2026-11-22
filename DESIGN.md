---
name: Fixie
description: Calm, trustworthy repair tool that proves every fix before it ships.
colors:
  accent: "#0a66f0"
  accent-dark: "#5aa0ff"
  accent-solid-dark: "#1f6feb"
  accent-fg: "#ffffff"
  bg: "#ffffff"
  surface: "#ffffff"
  surface-2: "#f5f5f6"
  surface-3: "#ebebed"
  line: "#e6e6e9"
  line-2: "#d4d4d8"
  fg: "#0a0a0b"
  fg-2: "#52525b"
  fg-3: "#71717a"
  bg-dark: "#0a0a0b"
  surface-dark: "#111113"
  surface-2-dark: "#18181b"
  surface-3-dark: "#232327"
  line-2-dark: "#36363c"
  fg-dark: "#fafafa"
  fg-2-dark: "#a1a1aa"
  fg-3-dark: "#8a8a93"
  ok: "#15803d"
  ok-bg: "#effaf3"
  ok-dark: "#4ade80"
  bad: "#d92d20"
  bad-bg: "#fef1f0"
  bad-dark: "#ff7b72"
  warn: "#a15c07"
  warn-bg: "#fff8eb"
  warn-dark: "#f5b942"
  add-bg: "#e8f6ec"
  del-bg: "#fdeceb"
  fixie-white: "#ffffff"
  fixie-ink: "#0b0d12"
  fixie-blue: "#2f7bff"
  fixie-blue-light: "#7fb2ff"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(44px, 6vw, 60px)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px (36px from md)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    letterSpacing: "-0.025em"
  subtitle:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"cv11\", \"ss01\""
  lead:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  caption:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  intro:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  panel-title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    letterSpacing: "-0.015em"
  micro:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
  metric:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 600
    fontFeature: "\"tnum\""
  metric-lg:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 600
    fontFeature: "\"tnum\""
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.625
rounded:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  full: "999px"
spacing:
  gutter: "16px"
  gutter-md: "24px"
  card-x: "20px"
  card-y: "14px"
  stack: "12px"
  grid: "24px"
  grid-lg: "48px"
  section: "80px"
  container: "1200px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.sm}"
    padding: "0 15px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.fg}"
    rounded: "{rounded.sm}"
    padding: "0 15px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-3}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.sm}"
    padding: "0 15px"
    height: "36px"
  button-ghost:
    textColor: "{colors.fg-2}"
    rounded: "{rounded.sm}"
    padding: "0 15px"
    height: "36px"
  button-sm:
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-lg:
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  badge:
    rounded: "{rounded.xs}"
    padding: "0 7px"
    height: "22px"
    typography: "{typography.caption}"
  badge-ok:
    backgroundColor: "{colors.ok-bg}"
    textColor: "{colors.ok}"
  badge-bad:
    backgroundColor: "{colors.bad-bg}"
    textColor: "{colors.bad}"
  badge-critical:
    backgroundColor: "{colors.bad}"
    textColor: "{colors.fixie-white}"
  badge-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn}"
  badge-neutral:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.fg-2}"
  meter:
    backgroundColor: "{colors.surface-3}"
    rounded: "{rounded.full}"
    height: "6px"
---

# Design System: Fixie

## Overview

**Creative North Star: "The Quiet Workbench"**

Fixie is a calm tool that proves fixes before they ship, and the interface behaves like the tool: neutral zinc surfaces, one-pixel hairlines, gently rounded containers and a single blue that only ever means "act here" or "this is the current state". The canon is user-pinned (Apple / Notion / shadcn), played straight: no costume, no theatrics. Evidence (error strings, diffs, scores, commit data) carries the drama; chrome stays out of its way.

Density is product-grade. Body text sits at 14px, labels at 13px, and screens are built from bordered cards on a white (light) or near-black (dark) ground. The system follows the operating system's light or dark preference; there is no manual toggle. Light mode uses soft, low-contrast ambient shadows; dark mode drops card shadows entirely and leans on the hairline borders and stepped surface tones.

The one piece of character is Fixie, a vector robot in white, ink and blue, used sparingly at fixed moments. The world refuses the neon-on-black "AI devtool" look, terminal costume, gradients and emoji.

**Key Characteristics:**
- Neutral zinc surfaces, 1px hairline borders, 8-12px radii.
- One blue accent for primary actions, selection, focus and live state.
- Status speaks in green / amber / red tinted badges; low severities stay neutral.
- Geist for everything, Geist Mono only for code, data and error strings.
- Follows system light/dark through CSS custom properties.
- Fixie the mascot appears only at five sanctioned places.
- All copy in Spanish; the user-facing name is always "Fixie".

## Colors

A neutral zinc ramp carrying one confident blue, with semantic green / amber / red reserved for health and severity. Every color is a CSS custom property on `:root`, swapped wholesale under `prefers-color-scheme: dark`.

### Primary
- **Proof Blue** (light `accent`): text links, focus outline, caret, active tab underline and icon, selected tab border, and the solid fill of primary buttons in light mode. The faint wash Accent Soft (8% in light, 10% in dark) marks selected tiles and text selection; the focus ring is the same blue at 35% (light) / 40% (dark).
- **Night Blue, text** (`accent-dark`): the dark-mode accent for links, icons, focus and the active underline. It is lighter so it reads on near-black.
- **Night Blue, fill** (`accent-solid-dark`): the dark-mode fill behind primary buttons and completed-step dots, deeper so white labels keep contrast. In light mode text and fill share one value.
- **On-accent white** (`accent-fg`): label color on every solid blue fill, both modes.

The built values differ from the direction contract's plan (#0a6cff / #3b8bff). The values above are the shipped truth.

### Neutral
- **Paper / Night ground** (`bg`, `bg-dark`): page background; also the browser theme color.
- **Surface** (`surface`, `surface-dark`): cards, inputs, outline buttons, product windows.
- **Surface 2** (`surface-2`, `surface-2-dark`): secondary buttons, hover fills, code blocks, card sub-headers, neutral badges, and banded landing sections (at 60% opacity).
- **Surface 3** (`surface-3`, `surface-3-dark`): secondary-button hover, meter track, skeleton highlight. In dark mode the base hairline shares this value.
- **Hairline** (`line`) and **Strong Hairline** (`line-2`, `line-2-dark`): card borders, dividers and section rules; the stronger line outlines inputs and outline buttons and colors the scrollbar thumb.
- **Ink** (`fg`, `fg-dark`), **Graphite** (`fg-2`, `fg-2-dark`), **Pewter** (`fg-3`, `fg-3-dark`): primary text, secondary text and labels, and tertiary metadata and placeholders.

### Semantic
- **Healthy green** (`ok`, `ok-bg`, `ok-dark`): fixed, verified, healthy, scores of 90 and above.
- **Alarm red** (`bad`, `bad-bg`, `bad-dark`): open incidents, error strings, scores under 50, Crítico and Alto findings.
- **Caution amber** (`warn`, `warn-bg`, `warn-dark`): scores from 50 to 89, Medio findings, "Revisar" states, one-time-secret warnings.
- **Diff tints** (`add-bg`, `del-bg`): added and removed lines in code diffs only. In dark mode the tints and status backgrounds become the same hue at 10-16% alpha.

### Fixie palette
- **Fixie White** (`fixie-white`), **Fixie Ink** (`fixie-ink`), **Fixie Blue** (`fixie-blue`), **Fixie Blue Light** (`fixie-blue-light`, the eyes): hardcoded in the mascot SVG and identical in both themes. The ink outline under the white fills keeps him legible on light and dark grounds. These colors belong to the mascot only; UI chrome uses the accent tokens.

### Named Rules
**The One Blue Rule.** Blue means action, selection, focus or live state, and nothing else. It never encodes severity, health or decoration.

**The Severity Ladder Rule.** Crítico is solid red with white text; Alto is tinted red; Medio is tinted amber; Bajo and Info are neutral zinc (Bajo in Graphite, Info in Pewter). Scores follow 90+ green, 50-89 amber, under 50 red. Low severities never borrow a hue.

**The Token-Only Rule.** UI color comes from the custom properties so both themes stay in sync. The only hex literals outside `globals.css` are the mascot palette and the QR code (ink on white).

## Typography

**Display Font:** Geist (via next/font, `--font-geist-sans`)
**Body Font:** Geist
**Label/Mono Font:** Geist Mono (via next/font, `--font-geist-mono`)

**Character:** One neo-grotesk family does all the work through weight and tight negative tracking at large sizes. It sounds like Apple and Vercel, not like a terminal. Body text enables the Geist `cv11` and `ss01` stylistic sets.

### Hierarchy
- **Display** (600, 44px, 60px from md, line-height 1.02, -0.035em, balanced, max 14ch): the landing hero headline only.
- **Headline** (600, 30px, 36px from md, -0.025em, balanced, 16-24ch): landing section titles.
- **Title** (600, 28px, -0.025em): page titles in the app, such as the project name and the Proyectos list. Empty-state titles step down to 20px.
- **Subtitle** (600, 15px): feature and list item titles, plus the header wordmark (with tight tracking).
- **Lead** (400, 17px, relaxed): the hero sentence, max 52ch. Section intros use 16px at max 60ch.
- **Body** (400, 14px, 1.5): default UI text and descriptions, relaxed leading in long prose.
- **Label** (500, 13px, Graphite): form labels, breadcrumbs, metadata rows, tab labels at 14px/500.
- **Caption** (400-500, 12px, Pewter): badges, timestamps, footnotes such as "Datos de ejemplo."
- **Score numerals** (600, 48px hero score / 28px category scores, tabular): Lighthouse and scan scores, tinted by the score ladder.
- **Mono** (400, 12px, relaxed; 13px for the hero error string): code blocks, `.env` reveals, file paths, error messages, diffs.

### Named Rules
**The Mono-Means-Machine Rule.** Geist Mono is only for code, data and error strings: snippets, file names, keys, stack messages and diffs. Headings, labels, buttons and badges never go mono.

**The Tabular Numbers Rule.** Any changing or compared number (scores, counts, step indices, sizes) uses tabular figures.

## Layout

Content sits in one centered container (max 1200px) with 16px side gutters, 24px from md. The header is a 56px sticky bar on a translucent, blurred ground. Landing sections stack at 80px vertical padding and separate with full-bleed hairline rules; alternate sections use a Surface 2 band at 60% opacity. Two-column splits use asymmetric fractional grids (hero 1 : 1.05, explainer sections 0.8 : 1.2) and collapse to one column below lg.

App screens are bordered cards stacked with 24px gaps. Card headers use 14px by 20px padding with a hairline under them. Multi-metric readouts are hairline-gapped grids: a 1px gap over a line-colored ground draws the dividers. They run at 2 columns on phones and 4 on desktop. Prose is capped at 44-70ch.

**Dashboard categories (built deviation).** The contract planned segmented tabs. The build ships underline tabs on desktop: inline label, icon and status badge, with a 2px blue underline under the active tab on a hairline baseline. On phones the same four categories become a 2x2 grid of bordered tiles; the active tile takes a blue border and Accent Soft fill. Ajustes sits apart as an outline button in the title row and turns secondary when active.

## Elevation & Depth

The system is hybrid, mostly flat. Depth comes from hairline borders and stepped surface tones first. Light mode adds whisper-soft ambient shadows to cards. Dark mode sets the card shadow to transparent and keeps only a deep float shadow for product windows. Exact values live in the sidecar.

### Shadow Vocabulary
- **Card**: a two-layer, 4%-opacity ambient lift under cards, icon tiles and code windows (light only).
- **Float**: a wider, softer drop under the landing product window and the mascot plate that overlaps it. It is the one place that is meant to feel lifted.

### Named Rules
**The Hairline-First Rule.** Separation is a 1px line before it is a shadow. Shadows are ambient and soft, never hard or offset, and they disappear in dark mode except for float.

## Shapes

Corners are gently rounded and consistent. Badges and the focus outline use 6px. Buttons, inputs, skeletons, inner panels and code blocks use 8px. Large buttons use 10px, cards and section-level grids 12px. The landing product window and its mascot plate use 16px. Pills (meters, status dots, step markers, avatars) are fully round. Borders are always 1px solid hairlines; there are no dashed or double rules.

## Components

### Buttons
Quiet and exact, in the shadcn style.
- **Shape:** gently rounded (8px; 10px on the large size), 36px tall by default, 32px small, 44px large. Labels are 14px/500 with an optional 16px Lucide icon and an 8px gap.
- **Primary:** solid accent fill with a white label. Hover mixes 12% black into the fill.
- **Secondary:** Surface 2 fill, ink label; hover steps to Surface 3.
- **Outline:** Surface fill with a strong hairline border; hover fills Surface 2.
- **Ghost:** no fill, Graphite label; hover fills Surface 2 and turns the label ink. Used for nav links, copy actions and icon-only buttons.
- **Focus / Disabled:** 3px accent ring and no outline. Disabled drops to 50% opacity. Color, border and shadow transitions run at 150ms ease.

### Chips (status badges)
- **Style:** 22px tall, 6px radius, 12px/500, tinted background with matching text and an optional 12px icon. Health uses green / amber / red tints; unknown states ("Sin analizar", "Sin datos", "Sin acceso") use neutral zinc.
- **State:** severity follows The Severity Ladder Rule. A "Sano" badge carries a check icon.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Surface.
- **Shadow Strategy:** the card shadow (light only); see Elevation & Depth.
- **Border:** 1px hairline.
- **Internal Padding:** 20px body; headers 14px by 20px with a bottom hairline.

### Inputs / Fields
- **Style:** 36px tall, 8px radius, Surface fill, strong hairline border, 12px horizontal padding, Pewter placeholder.
- **Focus:** the border turns accent and gains a 3px accent ring.
- **Error:** inline message in Alarm red with a Lucide alert icon. One-time secrets get an amber warning line.

### Navigation
- **Header:** sticky, 56px, 80% ground with backdrop blur and a bottom hairline. Mascot mark at 26px (still) plus the "Fixie" wordmark at 15px/600. Account actions are small ghost buttons separated by a 1px vertical rule.
- **Breadcrumb:** 13px Pewter with Lucide chevrons; the current item is Graphite.
- **Category tabs:** see Layout (built deviation from segmented).

### Meter
A 6px fully-round track in Surface 3. The fill takes `currentColor`, so its parent's ok / warn / bad text class tints it.

### Incident stepper and activity feed
Numbered 23px round markers. Done steps show a check; the active step shows a pulsing blue dot (1.6s live-dot animation). The activity feed uses 28px round tone-tinted icons. New rows enter with the 250ms step-in rise (4px, expo-out ease).

### Skeleton
An 8px-radius placeholder with a Surface 2 to Surface 3 shimmer (1.6s linear). It is the loading state for every streamed section.

### Fixie (signature)
A vector robot in white, ink and blue. Modes: idle, happy (hop), sad (sunk 1.5px), typing (alternating hands), reviewing (scanning eyes), and a 12s loop that cycles magnifier, laptop, glasses and paper. At rest he bobs 1.5px over 3.2s and blinks every 4.6s. All motion stops under reduced motion.

### Named Rules
**The Five Appearances Rule.** Fixie appears only in the header mark, the landing hero, empty states, the incident Actividad header and the footer. Never use him as decoration, a loading spinner or a list icon.

## Do's and Don'ts

### Do:
- **Do** take every color from the custom properties so light and dark stay paired; follow `prefers-color-scheme`.
- **Do** keep blue for primary actions, selection, focus and live state (light accent, dark accent and accent fill as recorded).
- **Do** show severity as Crítico solid red, Alto tinted red, Medio tinted amber, and Bajo / Info neutral zinc.
- **Do** separate with 1px hairlines and 8-12px radii; let light-mode shadows stay ambient and drop them in dark mode.
- **Do** use Lucide stroke icons: 1.75 stroke for feature, tab and section icons, and Lucide's default inside buttons and badges.
- **Do** use tabular figures for scores, counts and step numbers.
- **Do** write all UI copy in Spanish and call the product "Fixie".
- **Do** respect reduced motion: stop step-in, live-dot, skeleton shimmer and all mascot animation.

### Don't:
- **Don't** put emojis anywhere in the UI.
- **Don't** set headings, labels, buttons or badges in Geist Mono; mono is only for code, data and error strings.
- **Don't** use blue for severity or health, and don't give Bajo or Info a hue.
- **Don't** use gradients, neon glows or terminal-costume styling. The skeleton shimmer is the only gradient, and it is a loading state.
- **Don't** place Fixie anywhere beyond the header mark, landing hero, empty states, incident Actividad header and footer.
- **Don't** show the working name "Autosana" in user-facing copy.
- **Don't** use hard or offset shadows.
