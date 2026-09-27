import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { AUDIT_LOG_PATH } from "./config.js";

export function audit(entry: {
	tool: string;
	path: string;
	argsSummary: string;
	exitCode: number | null;
}): void {
	const line = JSON.stringify({
		ts: new Date().toISOString(),
		...entry,
	});
	appendFileSync(resolve(AUDIT_LOG_PATH), line + "\n");
}
