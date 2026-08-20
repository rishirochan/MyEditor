# PRODUCT.md

register: product

## What this is

MyEditor is a self-hostable, open-source LaTeX editor: write `.tex` in the
browser, get a live PDF preview, compile in a sandboxed TeX Live container,
collaborate in real time, and drive the whole thing over a REST API. It is
the Overleaf replacement you run on your own box.

## Users

Graduate students, researchers, and engineers writing long documents:
theses, papers, CVs, Beamer decks. They are technical enough to self-host
with Docker and to read a LaTeX build log. They are also, most of the time,
in a long focused session, not clicking around exploring.

Three modes matter:

1. **Deep write.** Hours in the editor + PDF split view. Chrome must recede.
2. **Debug the build.** Something failed at line 412; find it, fix it, recompile.
   Error state must be findable in under a second.
3. **Administrate.** Projects, API keys, AI provider settings. Infrequent,
   should be obvious without documentation.

## Product purpose

Remove every reason to pay for or trust a hosted LaTeX service. That means
the editing experience has to be at least as good as the commercial one,
not merely functional.

## Tone

Precise, quiet, technical. The voice of good developer tooling: short
labels, no exclamation marks, no marketing language inside the app. Say what
happened and what to do about it.

## Strategic principles

- **The document is the hero.** In the editor, the LaTeX source and the PDF
  page are the only things competing for attention. Every other pixel is
  chrome and should behave like chrome.
- **Density is respect.** These users want the file tree, the log, and the
  preview at once. Do not pad a tool UI like a landing page.
- **State must be legible at a glance.** Compiling / compiled / failed /
  offline / saving are the app's real vocabulary. Never encode a state in
  color alone.
- **Self-hosted means no surprises at build time.** No dependency that
  requires network access to a third party at build or first paint.

## Anti-references

- **Overleaf.** Green-on-white, dated toolbar chrome, dense in the wrong
  places. Do not converge on it.
- **Catppuccin / Nord / One Dark reskins.** The blue-violet dark theme is
  what every code tool does by reflex; MyEditor used to be one of them.
- **Generic SaaS dashboard.** Hero metric, four identical icon cards,
  gradient accents. Not this.
- **Cluttered IDE chrome.** Ribbons of icon buttons with no hierarchy.

## Reference points (in spirit, not in look)

Linear's information density and state clarity. Raycast's keyboard-first
calm. The physical experience of ink on paper under a desk lamp.
