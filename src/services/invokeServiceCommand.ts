import { formatUnknownError } from "../utils/errors";
import { logToConsole } from "./consoleLog";
import { invokeTauriOrNull } from "./tauriInvoke";

export type InvokeServiceCommandOptions<Fallback> = {
  title: string;
  cmd: string;
  args?: Record<string, unknown>;
  details?: Record<string, unknown>;
  fallback?: Fallback;
  nullResultBehavior?: "throw" | "return_fallback";
  omitArgsWhenUndefined?: boolean;
};

const SENSITIVE_KEY_EXACT_MATCHES = new Set([
  "token",
  "password",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "bearer",
  "credential",
  "credentials",
]);

const SENSITIVE_KEY_SUFFIXES = [
  "_token",
  "_key",
  "_secret",
  "_password",
  "_credential",
  "password",
  "secret",
];

const SENSITIVE_KEY_PATTERNS = [
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "refreshtoken",
  "client_secret",
  "clientsecret",
  "auth_token",
  "authtoken",
  "bearer_token",
  "session_token",
  "private_key",
  "privatekey",
];

function isSensitiveLogKey(key: string): boolean {
  const normalized = key.toLowerCase();

  if (SENSITIVE_KEY_EXACT_MATCHES.has(normalized)) {
    return true;
  }

  for (const suffix of SENSITIVE_KEY_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      return true;
    }
  }

  for (const pattern of SENSITIVE_KEY_PATTERNS) {
    if (normalized.includes(pattern)) {
      return true;
    }
  }

  return false;
}

function sanitizeLogScalar(value: unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    const parsed = new URL(value);
    if (!parsed.username && !parsed.password) return value;

    const suffix = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    const normalizedSuffix =
      suffix === "/" && !parsed.search && !parsed.hash ? "" : `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return `${parsed.protocol}//${parsed.host}${normalizedSuffix}`;
  } catch {
    return value;
  }
}

function redactLogPayload(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value == null) return value;
  if (depth > 6) return "[Truncated]";
  if (typeof value !== "object") return sanitizeLogScalar(value);
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

export async function invokeServiceCommand<T, Fallback = null>(
  options: InvokeServiceCommandOptions<Fallback>
): Promise<T | Fallback> {
  const fallback = (options.fallback ?? null) as Fallback;
  const sanitizedDetails = sanitizeLogArgs(options.details);

  try {
    const result =
      options.omitArgsWhenUndefined === false || options.args !== undefined
        ? await invokeTauriOrNull<T>(options.cmd, options.args)
        : await invokeTauriOrNull<T>(options.cmd);

    if (result != null) return result;
    if (options.nullResultBehavior === "return_fallback") return fallback;

    throw new Error(`IPC_NULL_RESULT: ${options.cmd}`);
  } catch (err) {
    logToConsole("error", options.title, {
      cmd: options.cmd,
      args: sanitizeLogArgs(options.args),
      ...sanitizedDetails,
      error: formatUnknownError(err),
    });
    throw err;
  }
}

export async function invokeService<T>(
  title: string,
  cmd: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  return invokeServiceCommand<T>({ title, cmd, args });
}

export async function invokeServiceWithDetails<T>(
  title: string,
  cmd: string,
  args?: Record<string, unknown>,
  details?: Record<string, unknown>
): Promise<T | null> {
  return invokeServiceCommand<T>({ title, cmd, args, details });
}
