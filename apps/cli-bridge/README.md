# MyEditor CLI bridge

This small Mac service lets MyEditor running in Docker use the Claude and Codex
CLIs already logged into your Mac. Docker sends a fixed completion request to
the bridge; the bridge runs only the selected CLI and returns its text. Login
tokens never enter the container.

## Setup

1. Confirm both Mac CLIs are ready:

   ```sh
   claude auth status
   codex login status
   ```

2. Generate a private bridge token and add it to the repository root `.env`:

   ```sh
   openssl rand -hex 32
   ```

   ```dotenv
   CLI_BRIDGE_TOKEN=paste-the-generated-value-here
   CLI_BRIDGE_URL=http://host.docker.internal:4141
   ```

3. Start the bridge on the Mac in its own terminal:

   ```sh
   pnpm bridge
   ```

4. Start or restart MyEditor so Docker receives the same token and URL.

The bridge listens on `0.0.0.0:4141` by default so Docker Desktop can reach it.
Keep the token secret and do not expose port 4141 through your router or a
public tunnel. Override the listener with `CLI_BRIDGE_HOST` and
`CLI_BRIDGE_PORT` when needed. `CLAUDE_CLI_PATH` and `CODEX_CLI_PATH` can
override binary detection.

## Endpoints

- `GET /health` — public liveness check.
- `GET /v1/status` — authenticated CLI and login status.
- `POST /v1/complete` — authenticated, validated Claude or Codex completion.

Every `/v1/*` request requires `Authorization: Bearer <CLI_BRIDGE_TOKEN>`.
Completions time out after 120 seconds, allow at most two concurrent CLI
processes, run outside the repository, and cannot supply commands, arguments,
or working directories.

## Check

```sh
pnpm --filter @myeditor/cli-bridge test
```
