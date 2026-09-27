import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { ALLOWLIST } from "./config.js";

export function resolvePath(input: string): string {
	const candidate = realpathSync(resolve(input));
	const isAllowed = ALLOWLIST.some((dir) => {
		const realDir = realpathSync(resolve(dir));
		return candidate.startsWith(realDir + "/") || candidate === realDir;
	});
	if (!isAllowed) {
		throw new Error(`Path outside allowlist: ${input}`);
	}
	return candidate;
}

export function resolveGitPath(input: string): string {
	return resolvePath(input);
}
