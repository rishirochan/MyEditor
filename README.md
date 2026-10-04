<h1 align="center">MyEditor</h1>
<p align="center"><strong>Overleaf, on your own Mac.</strong></p>
<p align="center">Write LaTeX, watch the PDF update as you type, and keep every file on your own machine.</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Next.js-15-black" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/macOS-Electron-47848F" alt="macOS desktop app" />
</p>

## Why this exists

Hosted LaTeX services are good products with a bad deal attached. Your thesis
lives on someone else's server, the compile queue is shared with everyone else
on the free tier, and the day you want an API you find out it costs money.

MyEditor is the same workflow without the deal. One Mac app gives you the
editor, a live PDF pane, your local TeX Live compiler, and a REST API that can
turn a `.tex` file into a PDF from any script you write. Nothing calls
home. If the internet drops, your compiler is still on your desk.

It is aimed at people who write long documents. Theses, papers, Beamer decks,
CVs. The kind of work where you spend six hours in the same split view and care
more about where the error on line 412 is than about the toolbar.

### The AI part costs you nothing extra

Most editors that ship an assistant hand you a second bill. Buy credits, or
paste an OpenAI key and watch the meter run while you write a thesis.

You are probably already paying for Claude or ChatGPT. If the `claude` or
`codex` CLI is logged in on your machine, MyEditor uses that subscription. No
API key, no per-token charge, no credit balance to top up. Your existing plan is
the plan. The app runs on your Mac, so it calls the CLI directly and never holds
your login token.

And the assistant works on the document instead of next to it. No tabbing out to
a chat window, pasting your preamble in for context, pasting the answer back,
and finding out it renamed a label you needed. It reads the files you point it
at, edits them in place, and gives you one button to undo the whole edit if you
hate it. The clipboard round trip is the part I actually wanted to delete.

## What you get

- Live PDF preview that recompiles on save, with build status pushed over
  WebSocket instead of polling.
- Sandboxed compiles. Every build runs in its own container with networking off,
  all Linux capabilities dropped, a PID cap, and configurable memory and CPU
  limits. A malicious `\write18` gets nowhere.
- Engine selection per project: `pdflatex`, `xelatex`, `lualatex`, `latex`, or
  `auto`, which reads your preamble and picks for you.
- Build logs parsed into clickable errors that jump to the offending line.
- A file tree, editor tabs, upload, rename, and a main-file setting so a
  multi-file thesis compiles from the right entrypoint.
- Templates: blank, article, thesis, Beamer, letter.
- A REST API with its own keys. Compile one-shot documents, manage projects and
  files, download PDFs. Full endpoint list in [DOCS.md](DOCS.md#-rest-api).
- An assistant that runs on the Claude or ChatGPT subscription you already pay
  for, through the local CLI, at no extra cost. An API key works too if you
  prefer one.
- That assistant edits the `.tex` files directly. Give it up to two files from
  the current folder as context, highlight a passage to scope the change, and
  undo the whole edit in one click. Nothing gets copy-pasted into a chat window.
- One-click build fixes. It reads the failing compile log, applies the minimal
  line edits, and queues a rebuild.

Sensible defaults, MIT licensed, no telemetry.

## Set it up

MyEditor is a Mac app (Apple Silicon). It bundles its own database, so there is
no Docker, no server, and no account or password.

1. **Build the app**:

   ```bash
   pnpm install
   pnpm desktop:dist     # writes apps/desktop/dist/MyEditor-<version>-arm64.dmg
   ```

2. Open the DMG and drag MyEditor to Applications. The build is unsigned, so the
   first time, right-click the app and choose **Open**.

3. On first launch MyEditor asks your name and sets up LaTeX by itself. It
   downloads [TinyTeX](https://yihui.org/tinytex/) (about 210 MB) into
   `~/Library/TinyTeX`, which needs no admin password. If you already have MacTeX
   or another TeX Live on your `PATH`, it uses that and skips the download.
   When a document needs a package TinyTeX doesn't ship, the build installs it
   and retries; the build log says what it added.

To use Claude or Codex, log the CLI in on your Mac (`claude`, `codex login`).
The app finds them on your shell's `PATH`.

Your data lives in `~/Library/Application Support/MyEditor`: `postgres/` is the
database, `data/` is the project files, and `server.log` is the first place to
look when something goes wrong.

## When it breaks

### Builds fail with "LaTeX is not installed yet"

The first-launch download didn't finish. Restart MyEditor and it picks up where
setup left off. If it fails again, the welcome screen shows why; usually it's
the internet connection.

### A build says a file or package was not found

MyEditor installs missing packages automatically, but only into TinyTeX. If you
use MacTeX instead, install the package yourself with
`sudo tlmgr install <package>`.

### The AI pane says the CLI is not installed or not logged in

Check it from a terminal: `claude auth status`, `codex login status`. Then
restart MyEditor so it picks up your shell's `PATH` again.

### The app shows an error on start

Read `~/Library/Application Support/MyEditor/server.log`. If the database was
left locked by a crash, quitting and reopening usually clears it.

## Coming soon

Not built yet. Listed here so you know where this is going.

**Screenshot verification.** Right now an AI edit is graded by whether the
document still compiles, which is a low bar. A clean build can still produce a
figure that ran off the page or a table that silently lost a column. The plan is
to render the affected PDF page, hand the image back to the model, and make it
check its own work against what you asked for before it says done.

**Update the document from a screenshot.** The other direction. Point at a
rendered page, say the caption is too far from the figure or this equation
should be numbered, and let the edit come back as LaTeX. Describing the fix in
terms of the output is how people actually think about a document.

**Worktree-style document history.** Git worktrees, for prose. Branch a chapter,
let the assistant rewrite it in isolation, compile both versions, and read them
side by side before anything touches your main draft. Right now an AI edit lands
on the real file and your only move is undo. That is fine for a paragraph and
wrong for a rewrite.

Opinions on any of these are welcome in the issues.

## Development

```bash
pnpm install
pnpm db        # terminal 1: Postgres on :5432 (data in .pg-dev/), prints the DATABASE_URL
pnpm dev       # terminal 2: web app on :3000, socket server on :3001
pnpm desktop   # build and run the Electron app against your real app data
```

Put the printed `DATABASE_URL` and a `SESSION_SECRET` in `apps/web/.env`.
Migrations run when the server starts.

Everything runs in one Node process: the Next.js server starts the compile queue
and the Socket.IO server from `src/instrumentation.ts`. The Electron shell in
`apps/desktop` starts Postgres, picks free ports, and runs that server.

Product intent is in [PRODUCT.md](PRODUCT.md), design tokens in
[DESIGN.md](DESIGN.md).

## License

[MIT](LICENSE). Fork it, host it, sell it, no strings.
