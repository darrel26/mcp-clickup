import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

type DaemonLinkStub = DurableObjectStub & { callTool: DaemonLink["callTool"] };

let daemonLink: DaemonLinkStub | null = null;

function createServer(): McpServer {
	const server = new McpServer({ name: "Clickup MCP Server", version: "1.0.0" });

	server.registerTool(
		"read_file",
		{ inputSchema: z.object({ path: z.string() }) },
		async ({ path }) => {
			if (!daemonLink) return { content: [{ type: "text", text: "daemon offline" }] };
			const result = await daemonLink.callTool("read_file", { path });
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		}
	);

	server.registerTool(
		"write_file",
		{ inputSchema: z.object({ path: z.string(), content: z.string() }) },
		async ({ path, content }) => {
			if (!daemonLink) return { content: [{ type: "text", text: "daemon offline" }] };
			const result = await daemonLink.callTool("write_file", { path, content });
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		}
	);

	server.registerTool(
		"list_dir",
		{ inputSchema: z.object({ path: z.string() }) },
		async ({ path }) => {
			if (!daemonLink) return { content: [{ type: "text", text: "daemon offline" }] };
			const result = await daemonLink.callTool("list_dir", { path });
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		}
	);

	server.registerTool(
		"run_git",
		{ inputSchema: z.object({ cwd: z.string(), args: z.array(z.string()), input: z.string().optional() }) },
		async ({ cwd, args, input }) => {
			if (!daemonLink) return { content: [{ type: "text", text: "daemon offline" }] };
			const result = await daemonLink.callTool("run_git", { cwd, args, input });
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		}
	);

	server.registerTool(
		"exec_command",
		{ inputSchema: z.object({ command: z.string(), cwd: z.string(), args: z.array(z.string()) }) },
		async ({ command, cwd, args }) => {
			if (!daemonLink) return { content: [{ type: "text", text: "daemon offline" }] };
			const result = await daemonLink.callTool("exec_command", { command, cwd, args });
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		}
	);

	return server;
}

const handler = createMcpHandler(createServer, { route: "/mcp" });

export class DaemonLink {
	private ws: WebSocket | null = null;
	private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();

	constructor(private state: DurableObjectState) {}

	async fetch(request: Request): Promise<Response | void> {
		if (request.headers.get("Upgrade") === "websocket") {
			const pair = new WebSocketPair();
			const server = pair[0];
			const client = pair[1];
			this.state.acceptWebSocket(server);
			return new Response(null, { status: 101, webSocket: client });
		}
		return new Response("Not Found", { status: 404 });
	}

	webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void | Promise<void> {
		const msg = JSON.parse(message as string);
		if (msg.type === "result") {
			const p = this.pending.get(msg.id);
			if (p) { p.resolve(msg.result); this.pending.delete(msg.id); }
		} else if (msg.type === "error") {
			const p = this.pending.get(msg.id);
			if (p) { p.reject(new Error(msg.error)); this.pending.delete(msg.id); }
		}
	}

	webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void | Promise<void> {
		this.ws = null;
		for (const [id, p] of this.pending) { p.reject(new Error("daemon offline")); this.pending.delete(id); }
	}

	webSocketError(ws: WebSocket, error: unknown): void | Promise<void> {
		this.ws = null;
	}

	async callTool(tool: string, args: any, timeout = 30000): Promise<any> {
		if (!this.ws) throw new Error("daemon offline");
		const id = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.ws!.send(JSON.stringify({ type: "call", id, tool, args }));
			setTimeout(() => {
				if (this.pending.has(id)) { this.pending.delete(id); reject(new Error("daemon offline")); }
			}, timeout);
		});
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		daemonLink ??= env.DAEMON_LINK.getByName("daemon-link") as DaemonLinkStub;

		const url = new URL(request.url);

		if (url.pathname === "/agent-ws") {
			const doInstance = env.DAEMON_LINK.getByName("daemon-link");
			return doInstance.fetch(request);
		}

		const auth = request.headers.get("Authorization");
		if (url.pathname === "/mcp") {
			if (auth !== `Bearer ${env.CLICKUP_KEY}`) {
				return new Response("Unauthorized", { status: 401 });
			}
			return handler(request, env, ctx);
		}

		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
