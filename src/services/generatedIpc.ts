import { formatUnknownError } from "../utils/errors";
import { logToConsole } from "./consoleLog";

export type GeneratedCommandResult<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: unknown };

type InvokeGeneratedIpcOptions<T> = {
  title: string;
  cmd: string;
  args?: Record<string, unknown>;
  invoke: () => Promise<GeneratedCommandResult<T>>;
};

function isSensitiveLogKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("api_key") ||
    normalized.includes("apikey") ||
    normalized.includes("access_token") ||
    normalized.includes("refreshtoken") ||
    normalized.includes("refresh_token") ||
    normalized.includes("authorization") ||
    normalized === "token" ||
    normalized.endsWith("_token") ||
    normalized.endsWith("token") ||
    normalized.includes("secret") ||
    normalized.includes("password")
  );
}

function redactLogPayload(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value == null) return value;
  if (depth > 6) return "[Truncated]";
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactLogPayload(item, seen, depth + 1));
  }

  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    output[key] = isSensitiveLogKey(key) ? "[REDACTED]" : redactLogPayload(item, seen, depth + 1);
  }
  return output;
}

function sanitizeLogArgs(value: Record<string, unknown> | undefined) {
  if (value === undefined) return undefined;
  try {
    return redactLogPayload(value, new WeakSet(), 0) as Record<string, unknown>;
  } catch {
    return { error: "LOG_ARG_REDACTION_FAILED" };
  }
}

function generatedCommandError(cmd: string, error: unknown) {
  if (error instanceof Error) return error;
  const message = typeof error === "string" ? error : formatUnknownError(error);
  return new Error(message || `IPC_ERROR_RESULT: ${cmd}`);
}

export async function invokeGeneratedIpc<T>(options: InvokeGeneratedIpcOptions<T>): Promise<T> {
  try {
    const result = await options.invoke();
    if (result.status === "error") {
      throw generatedCommandError(options.cmd, result.error);
    }
    if (result.data == null) {
      throw new Error(`IPC_NULL_RESULT: ${options.cmd}`);
    }
    return result.data;
  } catch (err) {
    logToConsole("error", options.title, {
      cmd: options.cmd,
      args: sanitizeLogArgs(options.args),
      error: formatUnknownError(err),
    });
    throw err;
  }
}
