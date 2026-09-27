# ClickUp MCP Server — Remote Daemon Architecture

An MCP server deployed on Cloudflare Workers that delegates filesystem and shell operations to a self-hosted daemon. The worker is the brain (routing, auth, MCP protocol); the daemon is the hands (filesystem, shell execution).

## Architecture

```
ClickUp AI → Worker (/mcp) → DaemonLink DO → WS → Daemon (local) → real filesystem
```

- **Worker** (Cloudflare): Auth, MCP protocol, Durable Object relay. Never touches disk.
- **Daemon** (self-hosted): Filesystem access, shell execution (`npm install`, `build`, `test`, `git`). Runs inside an allowlisted path.
- **Guardrail**: Every daemon operation resolves paths with `fs.realpath` and checks against `ALLOWLIST` before executing.
- **Audit log**: Every tool call is appended to `daemon/audit.log` as a JSON line with `{ts, tool, path, argsSummary, exitCode}`.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-upgrade/)
- A Cloudflare account with a Workers project

## Quick start

### 1. Clone and install dependencies

```bash
# Worker dependencies
cd mcp/clickup
npm install

# Daemon dependencies
cd daemon
npm install
```

### 2. Configure environment variables

#### Worker (Cloudflare)

Set these in `wrangler.toml` or via the Cloudflare dashboard:

| Variable | Description |
|---|---|
| `CLICKUP_KEY` | Bearer token for `/mcp` endpoint (ClickUp integration) |
| `DAEMON_KEY` | Bearer token for `/agent-ws` WebSocket endpoint |
| `WORKER_WS_URL` | URL of the worker (used by daemon to connect) |

#### Daemon

Create a `.env` file in `daemon/`:

```bash
# daemon/.env
ALLOWLIST='["/home/noid/Documents/repositories"]'
DAEMON_KEY="your-daemon-secret"
WORKER_WS_URL="wss://remote-mcp-clickup.<your-account>.workers.dev"
AUDIT_LOG_PATH="./audit.log"
```

`WORKER_WS_URL` is the URL of your deployed Cloudflare Worker. After running `npx wrangler deploy`, it becomes `https://remote-mcp-clickup.<account>.workers.dev`. For the daemon's WebSocket client, use the `wss://` scheme without a trailing slash — the `/agent-ws` path is appended automatically.

Find your worker name in `wrangler.jsonc` (`"name": "remote-mcp-clickup"`). If you're not sure of your account ID, run `npx wrangler whoami`.

**Security note**: `DAEMON_KEY` must match the `DAEMON_KEY` set on the Worker. The daemon authenticates every WebSocket connection with this key.

### 3. Deploy the worker and get the URL

```bash
cd mcp/clickup
npx wrangler deploy
```

After deploying, find your worker URL:

```bash
npx wrangler whoami  # shows account and worker name
```

The WebSocket URL is `wss://<worker-name>.<account>.workers.dev` — this is what goes into `WORKER_WS_URL`. For example, if the worker name is `remote-mcp-clickup`:

```bash
WORKER_WS_URL="wss://remote-mcp-clickup.<account>.workers.dev"
```

### 4. Start the daemon

```bash
cd daemon
npm run dev
```

Or build and run:

```bash
cd daemon
npm run build
npm start
```

The daemon connects outbound to `wss://<worker-name>.<account>.workers.dev/agent-ws`. It auto-reconnects with exponential backoff (1s → 2s → 4s … cap 30s) if disconnected.

### 5. Verify

Check the daemon is connected:
```bash
# The daemon logs "Daemon connected to ..." on successful connection
```

Check the Worker deployment:
```bash
npx wrangler tail --format pretty
```

## Available tools

| Tool | Description | Args |
|---|---|---|
| `read_file` | Read a file inside the allowlist | `path` |
| `write_file` | Write a file inside the allowlist | `path`, `content` |
| `list_dir` | List directory contents | `path` |
| `run_git` | Run git commands with `cwd` in allowlist | `cwd`, `args[]`, `input?` |
| `exec_command` | Execute a shell command with `cwd` in allowlist | `command`, `cwd`, `args[]` |

## Connecting to ClickUp

1. Deploy the worker and start the daemon
2. In ClickUp, configure an MCP integration pointing to your deployed worker URL:
   ```
   https://<your-worker>.<account>.workers.dev/mcp
   ```
3. Set the `Authorization` header to `Bearer <CLICKUP_KEY>`
4. ClickUp's AI will call tools via the worker, which forwards to the daemon. All filesystem operations are confined to the `ALLOWLIST` paths.

## Security

- **Path confinement**: `exec_command` and `run_git` set `cwd` to the guardrail-resolved path. Path escapes via `cd ../` are impossible — the enforcement point is `cwd`, not argument parsing.
- **Dual auth**: `/mcp` requires `Bearer <CLICKUP_KEY>`, `/agent-ws` requires `Bearer <DAEMON_KEY>`. Different secrets for different surfaces.
- **Audit trail**: Every tool call is logged to `daemon/audit.log`. Each line is a JSON object:
  ```json
  {"ts":"2026-09-27T12:00:00.000Z","tool":"exec_command","path":"/home/noid/Documents/repositories/my-project","argsSummary":"{\"command\":\"npm\",\"args\":[\"install\"]}","exitCode":0}
  ```
- **Offline safety**: If the daemon disconnects, the worker returns `{error: "daemon offline"}` immediately — no hanging timeouts.
- **No sudo**: The daemon runs with the permissions of the process that started it. It cannot access files outside the allowlist even if a command tries `cd /etc`.

## Customizing

### Add a new tool

Register it in `createServer()` in `src/index.ts`:

```ts
server.registerTool("my_tool", { inputSchema: z.object({ ... }) }, async ({ ... }) => {
  if (!daemonLink) return { content: [{ type: "text", text: "daemon offline" }] };
  const result = await daemonLink.callTool("my_tool", { ... });
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});
```

Then implement the handler in `daemon/src/tools.ts` and add the `case` in `daemon/src/index.ts`.

### Change the allowlist

Update `ALLOWLIST` in the daemon's `.env` file and restart the daemon. The worker does not need to be redeployed.

### Change the daemon port

Not applicable — the daemon connects outbound to the Worker, no local port is needed.

### Add `@types/node` dependency

## Project structure

```
mcp/clickup/
  src/index.ts              # Worker — MCP handler + DaemonLink DO
  daemon/
    src/
      index.ts              # Daemon entrypoint — WS client + reconnect loop
      config.ts             # Allowlist, secrets, paths from env
      guardrail.ts          # Path resolution + allowlist check
      tools.ts              # read_file, write_file, list_dir, run_git, exec_command
      audit.ts              # Append-only JSON log writer
    package.json
    tsconfig.json
  wrangler.jsonc            # Worker config — DO binding + env vars
  worker-configuration.d.ts # Generated Cloudflare types
```

## Running locally (development)

```bash
# Terminal 1: Start the worker dev server
cd mcp/clickup
npx wrangler dev

# Terminal 2: Start the daemon (it connects to the worker automatically)
cd daemon
npm run dev
```

The daemon connects to the worker's `/agent-ws` endpoint. The worker's `DaemonLink` Durable Object accepts the WebSocket connection. Both will log connection state changes. The daemon reconnects automatically if the worker restarts.
