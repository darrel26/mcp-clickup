import { WebSocket } from "ws";
import { DAEMON_KEY, WORKER_WS_URL } from "./config.js";
import { handleReadFile, handleWriteFile, handleListDir, handleRunGit, handleExecCommand } from "./tools.js";
import { audit } from "./audit.js";

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
const maxReconnectDelay = 30000;

function connect(): void {
	const url = WORKER_WS_URL.replace(/\/$/, "") + "/agent-ws";
	ws = new WebSocket(url, {
		headers: { Authorization: `Bearer ${DAEMON_KEY}` },
	});

	ws.on("open", () => {
		console.log(`Daemon connected to ${url}`);
		reconnectDelay = 1000;
	});

	ws.on("message", (raw: Buffer) => {
		const msg = JSON.parse(raw.toString());
		if (msg.type !== "call") return;
		const { id, tool, args } = msg as { id: string; tool: string; args: any };
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
			ws!.send(JSON.stringify({ type: "error", id, error: (err as Error).message }));
			audit({ tool, path: args.path ?? args.cwd ?? "", argsSummary: JSON.stringify(args).slice(0, 200), exitCode: null });
			return;
		}
		ws!.send(JSON.stringify({ type: "result", id, result }));
		audit({ tool, path: args.path ?? args.cwd ?? "", argsSummary: JSON.stringify(args).slice(0, 200), exitCode });
	});

	ws.on("close", () => {
		console.log("Daemon connection closed, reconnecting...");
		ws = null;
		setTimeout(connect, reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
	});

	ws.on("error", (err: Error) => {
		console.error("Daemon WS error:", err.message);
	});
}

connect();
console.log(`ClickUp daemon connecting to ${WORKER_WS_URL}/agent-ws`);
