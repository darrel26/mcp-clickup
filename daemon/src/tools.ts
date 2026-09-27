import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolvePath } from "./guardrail.js";

export function handleReadFile(path: string): string {
	return readFileSync(resolvePath(path), "utf-8");
}

export function handleWriteFile(path: string, content: string): void {
	writeFileSync(resolvePath(path), content, "utf-8");
}

export function handleListDir(path: string): string[] {
	return readdirSync(resolvePath(path));
}

export function handleRunGit(
	cwd: string,
	args: string[],
	input?: string
): { stdout: string; stderr: string; exitCode: number } {
	const resolved = resolvePath(cwd);
	try {
		const stdout = execSync(`git ${args.join(" ")}`, {
			cwd: resolved,
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
			input: input ?? undefined,
		});
		return { stdout, stderr: "", exitCode: 0 };
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; status?: number };
		return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.status ?? 1 };
	}
}

export function handleExecCommand(
	command: string,
	cwd: string,
	args: string[] = []
): { stdout: string; stderr: string; exitCode: number } {
	const resolvedCwd = resolvePath(cwd);
	try {
		const fullCommand = args.length > 0 ? `${command} ${args.join(" ")}` : command;
		const stdout = execSync(fullCommand, {
			cwd: resolvedCwd,
			shell: "sh",
			encoding: "utf-8",
			maxBuffer: 50 * 1024 * 1024,
		});
		return { stdout, stderr: "", exitCode: 0 };
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; status?: number };
		return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.status ?? 1 };
	}
}
