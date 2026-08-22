<h1 align="center">MyEditor</h1>
<p align="center"><strong>Overleaf, on your own box.</strong></p>
<p align="center">Write LaTeX in the browser, watch the PDF update as you type, and keep every file on hardware you control.</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Next.js-15-black" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Docker-ready-2496ED" alt="Docker" />
</p>

## Why this exists

Hosted LaTeX services are good products with a bad deal attached. Your thesis
lives on someone else's server, the compile queue is shared with everyone else
on the free tier, and the day you want an API you find out it costs money.

MyEditor is the same workflow without the deal. One `docker compose up -d` gives
you the editor, a live PDF pane, a sandboxed TeX Live compiler, and a REST API
that can turn a `.tex` file into a PDF from any script you write. Nothing calls
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
the plan. The [CLI bridge](#optional-the-cli-bridge) is how a containerized app
reaches a CLI on your host without ever holding your login token.

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

You need [Docker Desktop](https://docs.docker.com/get-docker/) installed and
running, and about 10 GB of free disk for the TeX Live image. That is the whole
list for this path.

```bash
git clone https://github.com/rishirochan/MyEditor.git
cd MyEditor
cp .env.example .env

# Set a real session secret before the first start, not after.
sed -i '' "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env

touch apps/worker/.env   # see the note below

docker compose up -d
```

Do not skip the secret. If `SESSION_SECRET` is left at the placeholder the stack
still boots, quietly, using a value that is published in this repository, which
means anyone can forge a session cookie for your instance. Changing it later
logs everyone out and makes stored AI keys undecryptable, so set it once, now.

The `touch` is a wart. The compile worker's start script reads
`apps/worker/.env`, that file is gitignored, and a fresh clone therefore does
not have one. Without it the worker container crash-loops and every build sits
in "queued" forever. An empty file is enough. Compose already passes the worker
every variable it needs.

First run takes a few minutes because Compose builds the TeX Live image, which
is a full distribution. After that it starts in seconds. Five containers come
up: Postgres, Redis, the web app, the WebSocket server, and the compile worker.

Check that all of it is alive:

```bash
curl -s localhost:3000/api/health
```

That reports Redis, both compile queues, the worker heartbeat, the Docker
socket, the compiler image, and the storage path separately, which makes it the
fastest way to find out which piece is unhappy. It does not probe Postgres. If
the database is down the app itself will tell you.

Open http://localhost:3000 and create an account. Signup is open by default, so
if the instance is only for you, set `DISABLE_SIGNUP=true` in `.env` and then
`docker compose up -d` again. Plain `docker compose restart` will not do,
because it does not re-read `.env`.

### Optional: the CLI bridge

This is what lets the assistant run on your existing Claude or ChatGPT
subscription instead of a metered API key. The app runs in a container, the CLI
is logged in on your host, and the container has no business holding your login
token. A small host process sits between them.

This path needs three things the Docker path does not: [pnpm](https://pnpm.io/installation)
and Node 22.9 or newer on the host, and the `claude` or `codex` CLI installed
and already logged in. The bridge runs on your machine, not in a container.

```bash
pnpm install
sed -i '' "s|^CLI_BRIDGE_TOKEN=.*|CLI_BRIDGE_TOKEN=$(openssl rand -hex 32)|" .env

pnpm bridge            # leave this running in its own terminal
docker compose up -d   # in another terminal, so the container gets the token
```

The token has to be at least 32 characters or the bridge refuses to start.

The bridge listens on `0.0.0.0:4141`, accepts a fixed completion request shape,
runs only the CLI you selected, and returns text. It cannot be told which
command to run, which arguments to pass, or which directory to run in. Tokens
stay on the host. Keep port 4141 off the public internet.

Details and endpoints: [apps/cli-bridge/README.md](apps/cli-bridge/README.md).

### Run it as a local Mac app

Two ways to live with this. Start it when you sit down to write, `docker compose
up -d` and `docker compose stop`, and that is a perfectly good life. Or spend
five minutes wiring it into the machine so it is just there, like Mail is there.
If you are hacking on MyEditor itself, neither applies, use `pnpm dev` from
[Development](#development) instead.

**Give it a real window.** Open http://localhost:3000 in Chrome, then the three
dot menu, `Cast, save and share`, `Install page as app`. You get a Dock icon and
a standalone window with no tab strip and no address bar. Edge is the same menu.
Safari 17 and later calls it `Add to Dock` under the Share button.

Nothing to configure for this. Chrome picks up the app name and icon from the
page.

**Bring Docker up at login.** Docker Desktop, Settings, General, tick `Start
Docker Desktop when you sign in`. Every long-running service in
`docker-compose.yml` is already `restart: always`, so once the daemon is back
the whole stack comes back with it. Nothing to add.

**Bring the bridge up at login.** This one needs a launch agent, because the
bridge is a plain host process. Save this as
`~/Library/LaunchAgents/com.myeditor.cli-bridge.plist`. Three strings need
replacing: the node binary, the path to your `.env`, and the path to
`index.mjs`. Use `which node` for the first, since a launch agent does not get
your shell's PATH and will not find a version-managed node. `CLI_BRIDGE_TOKEN`
must already be set in that `.env`, or launchd will respawn a crashing bridge
forever.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.myeditor.cli-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>--env-file-if-exists=/Users/you/MyEditor/.env</string>
    <string>/Users/you/MyEditor/apps/cli-bridge/src/index.mjs</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/myeditor-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/myeditor-bridge.log</string>
</dict>
</plist>
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.myeditor.cli-bridge.plist
curl localhost:4141/health
```

To stop it, `launchctl bootout gui/$(id -u)/com.myeditor.cli-bridge`. After
editing the plist, bootout then bootstrap again. Logs land in
`/tmp/myeditor-bridge.log`.

The bridge looks for the CLIs in `/opt/homebrew/bin` and `/usr/local/bin` before
falling back to PATH, so a Homebrew install is found without help. If yours
lives anywhere else, add an `EnvironmentVariables` dict to the plist with
`CLAUDE_CLI_PATH` and `CODEX_CLI_PATH` pointing at the binaries.

Now the Dock icon works from a cold boot. Open the laptop, click MyEditor,
write.

### Running it somewhere real

Behind a reverse proxy you need three things: route `/ws/*` to the ws container
on port 3001 without stripping the prefix, set `WS_PATH_PREFIX=/ws`, and set
`SECURE_COOKIES=true` if you terminate TLS. Nginx and Caddy examples are in
[DOCS.md](DOCS.md#reverse-proxy--websocket-setup).

On a platform that manages networking for you (Dokploy, Coolify, Portainer), add
`COMPOSE_FILE=docker-compose.yml` to `.env` so Compose skips the override file
that publishes ports on the host.

To use a hosted database instead of the bundled one, set `DATABASE_URL`. The
bundled Postgres will still start and sit idle.

## When it breaks

### The AI pane says the CLI bridge is unavailable

The bridge is a host process, not a container. Nothing starts it for you.

1. Is it running? `pnpm bridge` in a terminal on the host. Check with
   `curl localhost:4141/health`.
2. Is the token set in the repository root `.env`, and is it the same value the
   container has? Env vars are read at container start, so after editing `.env`
   you have to `docker compose up -d` again. Editing the file changes nothing
   for a container that is already running.
3. Requires Node 22 or newer. `node -v`.

If the pane reports an HTTP status or a JSON error instead, the bridge is up and
the failure is downstream. Read the actual message.

### The bridge is running but says the CLI is not logged in

Log in on the host, not in the container:

```bash
claude auth status
codex login status
```

If the CLI is installed somewhere unusual, set `CLAUDE_CLI_PATH` or
`CODEX_CLI_PATH` to the binary.

### `pnpm install` fails inside the Docker build

The Dockerfiles run `pnpm install --frozen-lockfile`. If you changed a
`package.json` without running `pnpm install` locally, the lockfile is stale and
the build stops. Run `pnpm install` on the host, commit the updated
`pnpm-lock.yaml`, then rebuild.

Warnings about ignored build scripts are expected. `.npmrc` sets
`strict-dep-builds=false` so a new transitive dependency with a postinstall hook
cannot break a deploy. The allowlist that actually decides which packages may
run scripts is `onlyBuiltDependencies` in `package.json`.

### Builds sit in "queued" forever

The web process only enqueues jobs. A separate worker runs them, which is what
`RUN_COMPILE_RUNNER_IN_WEB=false` means. If the worker is down, jobs queue and
nothing happens.

```bash
docker compose ps worker
docker compose logs worker
```

If the log says `node: .env: not found`, this is the missing
`apps/worker/.env` from the setup steps. Create it and rebuild:

```bash
touch apps/worker/.env
docker compose up -d --build worker
```

Otherwise read the log and check the heartbeat:

```bash
curl -s localhost:3000/api/health
```

For single-process local hacking you can set `RUN_COMPILE_RUNNER_IN_WEB=true`
and skip the worker entirely. Do not do that in production.

### Compiles fail because the container cannot see the project files

Only bites in local development. The worker bind-mounts `STORAGE_PATH` into each
compile container, so `apps/web/.env` and `apps/worker/.env` have to name the
same absolute path. A relative path or a mismatch means the compiler gets an
empty directory.

Docker Desktop also has to be allowed to share that directory. On Windows, run
the whole thing under WSL2; the compile path assumes a POSIX Docker socket.

### Build status never updates in the UI

The PDF only refreshes when the WebSocket connection is live. Two usual causes:
`SESSION_SECRET` differs between the `app` and `ws` services so the ws server
rejects the session cookie, or a reverse proxy is not forwarding the upgrade
headers. Open the browser network tab and look for a failing `/socket.io`
request.

### Migrations refuse to run

If the database was created with `db:push`, it has a schema but no migration
history, and `db:migrate` will not guess which migrations to skip. Adopt the
existing schema once:

On a Docker install, run it through Compose. Postgres has no host port, so the
host-side pnpm command cannot reach it:

```bash
docker compose run --rm -e DRIZZLE_BASELINE=latest migrate
```

In local development, where Postgres is published on 5432:

```bash
DRIZZLE_BASELINE=latest pnpm --filter @myeditor/web db:migrate
```

Use `db:migrate`, not `db:push`. `pnpm setup` already does.

### Everyone's saved AI keys stopped working

You rotated `SESSION_SECRET`. Stored provider keys are encrypted with a key
derived from it, so rotating it makes them undecryptable. Session cookies die
too. If you have to rotate, clear `user_ai_settings.build_api_key` and
`writer_api_key` and have users re-enter them.

### Port 3000 is taken

Set `PORT` (and `WS_PORT`) in `.env`, then `docker compose up -d`.

### Login bounces back to the login page over HTTPS

Set `SECURE_COOKIES=true`. Without it the session cookie is issued without the
`Secure` flag and the browser drops it.

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

Create `apps/web/.env`, `apps/ws/.env`, and `apps/worker/.env` first. There are
no examples for these three and every one of them is required: `pnpm setup`
fails at the migration step without the first, and `pnpm dev` crashes the ws
server and the worker without the other two. Contents are in
[DOCS.md](DOCS.md).

Then `pnpm setup` once, `pnpm dev` after that. It starts Postgres and Redis,
waits for them to be healthy, then runs the web app, ws server, and worker in
parallel with prefixed logs. `pnpm stop` shuts the containers down.

Full development setup, the environment variable reference, the API docs, the
architecture, and the schema live in [DOCS.md](DOCS.md). Product intent is in
[PRODUCT.md](PRODUCT.md), design tokens in [DESIGN.md](DESIGN.md).

## License

[MIT](LICENSE). Fork it, host it, sell it, no strings.
