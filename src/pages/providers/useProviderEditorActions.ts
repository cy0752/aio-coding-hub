import { toast } from "sonner";
import { copyText } from "../../services/clipboard";
import { logToConsole } from "../../services/consoleLog";
import {
  providerGetApiKey,
  providerUpsert,
  providerOAuthStatus,
} from "../../services/providers/providers";
import {
  createProviderEditorDialogSchema,
  type ProviderEditorDialogFormInput,
  type ProviderEditorDialogFormOutput,
} from "../../schemas/providerEditorDialog";
import { normalizeBaseUrlRows } from "./baseUrl";
import { validateProviderClaudeModels } from "./validators";
import type { ActionContext } from "./providerEditorActionContext";

export type { ActionContext } from "./providerEditorActionContext";

export function resolveStreamIdleTimeoutSeconds(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 3600) {
    return undefined;
  }
  return value;
}

function toastFirstSchemaIssue(
  mode: "create" | "edit",
  issues: Array<{ path: Array<PropertyKey>; message: string }>
) {
  const orderedFields: Array<keyof ProviderEditorDialogFormInput> = [
    "name",
    ...(mode === "create" ? (["api_key"] as const) : []),
    "cost_multiplier",
    "limit_5h_usd",
    "limit_daily_usd",
    "limit_weekly_usd",
    "limit_monthly_usd",
    "limit_total_usd",
    "daily_reset_time",
  ];

  const messageByField = new Map<string, string>();
  for (const issue of issues) {
    const firstSegment = issue.path[0];
    if (typeof firstSegment !== "string") continue;
    if (!messageByField.has(firstSegment)) {
      messageByField.set(firstSegment, issue.message);
    }
  }

  for (const field of orderedFields) {
    const maybeMessage = messageByField.get(field);
    if (maybeMessage) {
      toast(maybeMessage);
      return;
    }
  }

  const fallback = issues.find((issue) => Boolean(issue.message));
  if (fallback) {
    toast(fallback.message);
  }
}

export async function ensureSavedApiKey(ctx: ActionContext, silent = false) {
  if (ctx.savedApiKey?.trim()) {
    return ctx.savedApiKey;
  }
  if (ctx.mode !== "edit" || !ctx.editProvider) {
    return null;
  }

  try {
    if (ctx.apiKeyFetchPromiseRef.current) {
      const key = await ctx.apiKeyFetchPromiseRef.current;
      if (!key && !silent && ctx.apiKeyFetchErrorRef.current) {
        toast("读取 API Key 失败");
      }
      return key;
    }

    ctx.setFetchingApiKey(true);
    const request = Promise.resolve(providerGetApiKey(ctx.editProvider.id))
      .then((nextKey) => {
        const normalized = nextKey?.trim() ? nextKey : null;
        ctx.apiKeyFetchedRef.current = true;
        ctx.apiKeyFetchErrorRef.current = false;
        ctx.setSavedApiKey(normalized);
        ctx.form.setValue("api_key", normalized ?? "", {
          shouldDirty: false,
          shouldTouch: false,
          shouldValidate: false,
        });
        return normalized;
      })
      .catch(() => {
        ctx.apiKeyFetchErrorRef.current = true;
        if (!silent) {
          toast("读取 API Key 失败");
        }
        return null;
      })
      .finally(() => {
        ctx.apiKeyFetchPromiseRef.current = null;
        ctx.setFetchingApiKey(false);
      });
    ctx.apiKeyFetchPromiseRef.current = request;
    return await request;
  } catch {
    if (!silent) {
      toast("读取 API Key 失败");
    }
    return null;
  }
}

export async function copyApiKey(ctx: ActionContext) {
  const actualValue = ctx.apiKeyValue || (await ensureSavedApiKey(ctx, false)) || "";
  if (!actualValue.trim()) {
    toast("暂无可复制的 API Key");
    return;
  }
  try {
    await copyText(actualValue);
    toast("已复制 API Key");
  } catch {
    toast("复制 API Key 失败");
  }
}

export async function save(ctx: ActionContext) {
  if (ctx.saving) return;
  const isCx2cc = ctx.authMode === "cx2cc";

  const formValues = ctx.form.getValues();
  const parsed = createProviderEditorDialogSchema({
    mode: ctx.mode,
    skipApiKeyCheck: isCx2cc,
  }).safeParse({
    ...formValues,
    auth_mode: isCx2cc ? "api_key" : ctx.authMode,
  });
  if (!parsed.success) {
    toastFirstSchemaIssue(ctx.mode, parsed.error.issues);
    return;
  }

  const values: ProviderEditorDialogFormOutput = parsed.data;
  const parsedTimeout = resolveStreamIdleTimeoutSeconds(ctx.streamIdleTimeoutSeconds);
  if (parsedTimeout === undefined) {
    toast("流式空闲超时必须为 0-3600 秒");
    return;
  }

  let finalBaseUrls: string[] = [];
  let finalBaseUrlMode = ctx.baseUrlMode;

  if (ctx.authMode === "oauth") {
    finalBaseUrls = [];

    let effectiveOauthStatus = ctx.oauthStatus;
    if (!effectiveOauthStatus?.connected && ctx.editingProviderId) {
      try {
        const latestStatus = await providerOAuthStatus(ctx.editingProviderId);
        ctx.setOauthStatus(latestStatus);
        effectiveOauthStatus = latestStatus;
      } catch (err) {
        logToConsole("warn", "保存前刷新 OAuth 状态失败", {
          cli_key: ctx.cliKey,
          provider_id: ctx.editingProviderId,
          error: String(err),
        });
      }
    }

    if (!effectiveOauthStatus?.connected) {
      toast("请先完成 OAuth 登录");
      return;
    }
  } else if (isCx2cc) {
    finalBaseUrls = [];
    finalBaseUrlMode = "order";

    if (!ctx.cx2ccSourceValue) {
      toast("请选择源 Codex 来源");
      return;
    }
  } else {
    const normalized = normalizeBaseUrlRows(ctx.baseUrlRows);
    if (!normalized.ok) {
      toast(normalized.message);
      return;
    }
    finalBaseUrls = normalized.baseUrls;
  }

  if (ctx.cliKey === "claude" && ctx.authMode !== "oauth") {
    const modelError = validateProviderClaudeModels(ctx.claudeModels);
    if (modelError) {
      toast(modelError);
      return;
    }
  }

  ctx.setSaving(true);
  try {
    const apiKeyToSave =
      ctx.authMode === "oauth"
        ? null
        : ctx.mode === "edit" && !ctx.apiKeyDirty
          ? ""
          : values.api_key;
    const effectiveCostMultiplier =
      isCx2cc && ctx.isCodexGatewaySource
        ? 0
        : isCx2cc && ctx.selectedCx2ccSourceProvider
          ? ctx.selectedCx2ccSourceProvider.cost_multiplier
          : values.cost_multiplier;

    const editProviderId = ctx.mode === "edit" && ctx.editProvider ? ctx.editProvider.id : null;
    const saved = await providerUpsert({
      ...(editProviderId ? { provider_id: editProviderId } : {}),
      cli_key: ctx.cliKey,
      name: values.name,
      base_urls: finalBaseUrls,
      base_url_mode: finalBaseUrlMode,
      auth_mode: isCx2cc ? "api_key" : (ctx.authMode as "api_key" | "oauth"),
      api_key: ctx.authMode === "oauth" || isCx2cc ? null : apiKeyToSave,
      enabled: values.enabled,
      cost_multiplier: effectiveCostMultiplier,
      limit_5h_usd: values.limit_5h_usd,
      limit_daily_usd: values.limit_daily_usd,
      daily_reset_mode: values.daily_reset_mode,
      daily_reset_time: values.daily_reset_time,
      limit_weekly_usd: values.limit_weekly_usd,
      limit_monthly_usd: values.limit_monthly_usd,
      limit_total_usd: values.limit_total_usd,
      tags: ctx.tags,
      note: values.note,
      stream_idle_timeout_seconds: parsedTimeout,
      ...(ctx.cliKey === "claude" && ctx.authMode !== "oauth"
        ? { claude_models: ctx.claudeModels }
        : {}),
      source_provider_id: isCx2cc && !ctx.isCodexGatewaySource ? ctx.sourceProviderId : null,
      bridge_type: isCx2cc ? "cx2cc" : null,
    });

    if (!saved) {
      return;
    }

    ctx.form.setValue("api_key", "", { shouldDirty: false, shouldValidate: false });
    logToConsole("info", ctx.mode === "create" ? "保存 Provider" : "更新 Provider", {
      cli: saved.cli_key,
      provider_id: saved.id,
      name: saved.name,
      base_urls: saved.base_urls,
      base_url_mode: saved.base_url_mode,
      enabled: saved.enabled,
      cost_multiplier: saved.cost_multiplier,
      claude_models: saved.claude_models,
      limit_5h_usd: saved.limit_5h_usd,
      limit_daily_usd: saved.limit_daily_usd,
      daily_reset_mode: saved.daily_reset_mode,
      daily_reset_time: saved.daily_reset_time,
      limit_weekly_usd: saved.limit_weekly_usd,
      limit_monthly_usd: saved.limit_monthly_usd,
      limit_total_usd: saved.limit_total_usd,
      tags: saved.tags,
      note: saved.note,
      stream_idle_timeout_seconds: saved.stream_idle_timeout_seconds,
    });
    toast(ctx.mode === "create" ? "Provider 已保存" : "Provider 已更新");

    ctx.onSaved(saved.cli_key);
    ctx.onOpenChange(false);
  } catch (err) {
    logToConsole(
      "error",
      ctx.mode === "create" ? "保存 Provider 失败" : "更新 Provider 失败",
      {
        error: String(err),
        cli: ctx.cliKey,
        provider_id: ctx.mode === "edit" && ctx.editProvider ? ctx.editProvider.id : undefined,
      }
    );
    toast(`${ctx.mode === "create" ? "保存" : "更新"}失败：${String(err)}`);
  } finally {
    ctx.setSaving(false);
  }
}
