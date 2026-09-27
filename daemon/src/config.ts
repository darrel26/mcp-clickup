export const ALLOWLIST: string[] = JSON.parse(process.env.ALLOWLIST ?? "[]");
export const DAEMON_KEY: string = process.env.DAEMON_KEY ?? "";
export const WORKER_WS_URL: string = process.env.WORKER_WS_URL ?? "";
export const AUDIT_LOG_PATH: string = process.env.AUDIT_LOG_PATH ?? "./audit.log";
