import "dotenv/config";
import { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { DAEMON_KEY, WORKER_WS_URL } from "./config.js";
import { handleReadFile, handleWriteFile, handleListDir, handleRunGit, handleExecCommand } from "./tools.js";
import { audit } from "./audit.js";

function log(level: "info" | "warn" | "error", msg: string): void {
	console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`);
}

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
const maxReconnectDelay = 30000;
let connectAttempt = 0;

function connect(): void {
	const url = WORKER_WS_URL.replace(/\/$/, "") + "/agent-ws";
	connectAttempt += 1;
	log("info", `Connecting to ${url} (attempt ${connectAttempt})`);

	ws = new WebSocket(url, {
		headers: { Authorization: `Bearer ${DAEMON_KEY}` },
	});

	ws.on("open", () => {
		log("info", `Connected to ${url}`);
		connectAttempt = 0;
		reconnectDelay = 1000;
	});

	ws.on("unexpected-response", (_req, res: IncomingMessage) => {
		let body = "";
		res.on("data", (chunk) => (body += chunk));
		res.on("end", () => {
			log("error", `Handshake rejected: HTTP ${res.statusCode} ${res.statusMessage} — ${body || "(empty body)"}`);
		});
	});

	ws.on("message", (raw: Buffer) => {
		const msg = JSON.parse(raw.toString());
		if (msg.type !== "call") return;
		const { id, tool, args } = msg as { id: string; tool: string; args: any };
		log("info", `Tool call: ${tool} ${JSON.stringify(args).slice(0, 200)}`);
		let result: any;
		let exitCode: number | null = 0;
		try {
			switch (tool) {
				case "read_file":
					result = handleReadFile(args.path);
					break;
				case "write_file":
					handleWriteFile(args.path, args.content);
					result = { ok: true };
					break;
				case "list_dir":
					result = handleListDir(args.path);
					break;
				case "run_git":
					const gitResult = handleRunGit(args.cwd, args.args, args.input);
					result = gitResult;
					exitCode = gitResult.exitCode;
					break;
				case "exec_command":
					const execResult = handleExecCommand(args.command, args.cwd, args.args);
					result = execResult;
					exitCode = execResult.exitCode;
					break;
				default:
					throw new Error(`Unknown tool: ${tool}`);
			}
		} catch (err: unknown) {
			const message = (err as Error).message;
			log("error", `Tool call failed: ${tool} — ${message}`);
			ws!.send(JSON.stringify({ type: "error", id, error: message }));
			audit({ tool, path: args.path ?? args.cwd ?? "", argsSummary: JSON.stringify(args).slice(0, 200), exitCode: null });
			return;
		}
		log("info", `Tool call succeeded: ${tool}`);
		ws!.send(JSON.stringify({ type: "result", id, result }));
		audit({ tool, path: args.path ?? args.cwd ?? "", argsSummary: JSON.stringify(args).slice(0, 200), exitCode });
	});

	ws.on("close", (code: number, reason: Buffer) => {
		log("warn", `Connection closed (code ${code}${reason.length ? `, reason: ${reason.toString()}` : ""}). Reconnecting in ${reconnectDelay}ms...`);
		ws = null;
		setTimeout(connect, reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
	});

	ws.on("error", (err: Error) => {
		log("error", `WebSocket error: ${err.message}`);
	});
}

log("info", `ClickUp daemon starting, target: ${WORKER_WS_URL}/agent-ws`);
connect();
