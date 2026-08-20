# DESIGN.md

The system lives in `apps/web/src/app/globals.css`. That file is the single
source of truth; this document explains it. **Never hardcode a color in a
component.** If a value is missing, add a token, don't inline a hex.

## Direction: "Graphite & Signal"

Dark-first. The scene that decides it: someone six hours into a thesis
chapter at 1am, one lamp on, a bright white PDF page in the middle of a 27"
display. Surfaces are warm near-black graphite (hue ~75, chroma ~0.005), not
the blue-black every code tool reaches for. White paper reads as paper
against warm graphite; against blue-black it reads as a hole punched in the
screen.

The accent is a cool cyan, complement to the warm surface. It is also the
one useful hue that leaves the entire red / amber / green semantic band
uncontested, which matters in a build-log UI where error and warning are
load-bearing.

Color strategy: **Restrained.** Tinted neutrals carry the surface; accent
appears only on primary actions, current selection, focus, and active state.
Never as decoration.

## Tokens

Use Tailwind utilities generated from the theme. Never `style={{}}` colors.

### Surfaces (lightest to darkest, dark theme)

| Token | Utility | Use |
|---|---|---|
| `bg-elevated` | `bg-bg-elevated` | menus, popovers, hover fills, chips |
| `bg-primary` | `bg-bg-primary` | main content surface, page body |
| `bg-secondary` | `bg-bg-secondary` | panels, sidebar, headers, toolbars |
| `bg-inset` | `bg-bg-inset` | inputs, code blocks, wells (recessed) |
| `bg-tertiary` | `bg-bg-tertiary` | app frame, deepest gutter, auth backdrop |
| `overlay` | `bg-overlay` | dialog scrim (warm, not `bg-black/60`) |

### Lines

`border-border-subtle` (internal dividers) · `border-border` (default) ·
`border-border-strong` (hover, emphasis)

### Text

`text-text-primary` · `text-text-secondary` · `text-text-muted`
All three clear AA on every surface above. Do not go below `text-muted`.

### Accent and semantics

`accent` `accent-hover` `accent-fg` (text on accent fill) `accent-subtle`
(tinted background) `accent-muted` (tinted border)

`success` `error` `warning`, each with a `-subtle` background counterpart:
`bg-error-subtle text-error` for banners, never `bg-error/10`.

Text on a filled accent button is `text-accent-fg`, not `text-bg-primary`.

`text-ink-on-hue` is the one token that does not switch with the theme. Use
it for text sitting on a runtime-generated collaborator presence color,
which is the same fixed pastel in dark and light.

## Component vocabulary

Six classes in `@layer components`. Use them; do not re-invent a button.

- `.btn` + one of `.btn-primary` `.btn-secondary` `.btn-ghost` `.btn-danger`
- `.input` for every text field, textarea, and select trigger
- `.panel` for a bordered surface block

Sizing beyond the default stays inline (`px-4 py-2.5`, `text-base`).

## Typography

System stack, one family. No webfonts: a self-hosted Docker build must never
depend on fonts.google.com. `--font-sans` leads with Inter if installed and
falls back to the platform UI font. `--font-mono` for code, file paths, log
output, API keys, and the wordmark.

Fixed rem scale, ratio ~1.2. Hierarchy from weight and color, not size
alone. Page title `text-2xl font-semibold`, section `text-base font-semibold`,
label `text-xs font-medium uppercase tracking-wide text-text-muted`.

Prose caps at 65–75ch. Tables and log output may run wider.

## Elevation

`shadow-xs` → `shadow-xl` are pre-tinted warm and include a top inset
hairline at `md` and above. Drop any `shadow-black/30`-style modifier at call
sites; it fights the token.

Depth order in dark UI is surface lightness first, hairline second, shadow
third. A popover is `bg-bg-elevated border border-border shadow-lg`.

## Motion

150–250ms, `ease-out-quart` / `quint` / `expo`. Motion conveys state change
only: open, close, appear, status transition. Never animate layout
properties; transition `opacity`, `transform`, `background-color`,
`border-color`, `color`. `prefers-reduced-motion` is honoured globally in
`@layer base`.

## Focus and states

A global `:focus-visible` ring is defined in base. Do not add
`focus:outline-none` without replacing the affordance.

Every interactive component ships default / hover / focus / active /
disabled, and where it applies loading and error. Loading in content areas is
a skeleton on `bg-bg-elevated` with `animate-pulse-soft`, not a centered
spinner.

## Rules specific to this app

- **Never encode state in color alone.** Compile status, log severity, and
  presence all carry an icon or a label alongside the hue.
- **The PDF page is white and that is correct.** Do not tint it, do not add a
  colored border. Let the warm graphite surround do the work.
- **Editor and gutter share one background.** The gutter is separated by a
  hairline, not by a different slab of color.
- **Density in the editor, air in the dashboard.** Editor chrome rows are
  ~32–36px; dashboard content breathes.

## Bans

Side-stripe borders (`border-l-2` accents). Gradient text. Decorative
glassmorphism. The hero-metric template. Grids of identical icon+heading+text
cards. Nested cards. Modal as the first answer to an inline problem.
Em dashes in UI copy.
