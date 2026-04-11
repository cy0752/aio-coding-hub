import { toast } from "sonner";
import { logToConsole } from "../../services/consoleLog";
import {
  providerUpsert,
  providerDelete,
  providerOAuthStartFlow,
  providerOAuthRefresh,
  providerOAuthDisconnect,
  providerOAuthStatus,
  providerOAuthFetchLimits,
} from "../../services/providers/providers";
import type { ActionContext } from "./providerEditorActionContext";
import { resolveStreamIdleTimeoutSeconds } from "./useProviderEditorActions";

export async function handleOAuthLogin(ctx: ActionContext) {
  ctx.setOauthLoading(true);
  let autoSavedProviderId: number | null = null;
  let shouldRollbackAutoSavedProvider = false;

  const rollbackAutoSavedProvider = async () => {
    if (!shouldRollbackAutoSavedProvider || !autoSavedProviderId) return;
    try {
      const deleted = await providerDelete(autoSavedProviderId);
      if (!deleted) {
        logToConsole(
          "warn",
          `OAuth 登录失败后清理临时 Provider 失败：${ctx.form.getValues().name || "OAuth Provider"}`,
          { cli_key: ctx.cliKey, provider_id: autoSavedProviderId }
        );
      }
    } catch (cleanupErr) {
      logToConsole(
        "error",
        `OAuth 登录失败后清理临时 Provider 异常：${ctx.form.getValues().name || "OAuth Provider"}`,
        { cli_key: ctx.cliKey, provider_id: autoSavedProviderId, error: String(cleanupErr) }
      );
    }
  };

  try {
    let targetProviderId = ctx.editingProviderId;
    const parsedTimeout = resolveStreamIdleTimeoutSeconds(ctx.streamIdleTimeoutSeconds);
    if (parsedTimeout === undefined) {
      toast("流式空闲超时必须为 0-3600 秒");
      return;
    }

    if (!targetProviderId) {
      const formValues = ctx.form.getValues();
      if (!formValues.name?.trim()) {
        toast("请先填写 Provider 名称");
        return;
      }
      const saved = await providerUpsert({
        cli_key: ctx.cliKey,
        name: formValues.name.trim(),
        base_urls: [],
        base_url_mode: "order",
        auth_mode: "oauth",
        api_key: null,
        enabled: formValues.enabled,
        cost_multiplier: Number(formValues.cost_multiplier) || 1.0,
        limit_5h_usd: formValues.limit_5h_usd ? Number(formValues.limit_5h_usd) : null,
        limit_daily_usd: formValues.limit_daily_usd ? Number(formValues.limit_daily_usd) : null,
        daily_reset_mode: formValues.daily_reset_mode ?? "fixed",
        daily_reset_time: formValues.daily_reset_time ?? "00:00:00",
        limit_weekly_usd: formValues.limit_weekly_usd
          ? Number(formValues.limit_weekly_usd)
          : null,
        limit_monthly_usd: formValues.limit_monthly_usd
          ? Number(formValues.limit_monthly_usd)
          : null,
        limit_total_usd: formValues.limit_total_usd ? Number(formValues.limit_total_usd) : null,
        stream_idle_timeout_seconds: parsedTimeout,
      });
      if (!saved) {
        toast("自动保存 Provider 失败");
        return;
      }
      targetProviderId = saved.id;
      autoSavedProviderId = saved.id;
      shouldRollbackAutoSavedProvider = true;
    }

    const result = await providerOAuthStartFlow(ctx.cliKey, targetProviderId);
    if (result?.success) {
      shouldRollbackAutoSavedProvider = false;

      let status: Awaited<ReturnType<typeof providerOAuthStatus>> = null;
      try {
        status = await providerOAuthStatus(targetProviderId);
        ctx.setOauthStatus(status);
      } catch (statusErr) {
        toast("OAuth 登录成功，但读取连接状态失败，可稍后重试");
        logToConsole(
          "warn",
          `OAuth 登录后读取状态失败：${ctx.form.getValues().name || "OAuth Provider"}`,
          {
            cli_key: ctx.cliKey,
            provider_id: targetProviderId,
            provider_type: result.provider_type,
            error: String(statusErr),
          }
        );
      }

      let limits: Awaited<ReturnType<typeof providerOAuthFetchLimits>> = null;
      try {
        limits = await providerOAuthFetchLimits(targetProviderId);
        if (!limits) {
          toast("OAuth 登录成功，但获取用量失败，可稍后重试");
          logToConsole(
            "warn",
            `OAuth 登录后获取用量失败：${ctx.form.getValues().name || "OAuth Provider"}`,
            {
              cli_key: ctx.cliKey,
              provider_id: targetProviderId,
              provider_type: result.provider_type,
              email: status?.email,
            }
          );
        }
      } catch (err) {
        toast("OAuth 登录成功，但获取用量失败，可稍后重试");
        logToConsole(
          "warn",
          `OAuth 登录后获取用量异常：${ctx.form.getValues().name || "OAuth Provider"}`,
          {
            cli_key: ctx.cliKey,
            provider_id: targetProviderId,
            provider_type: result.provider_type,
            email: status?.email,
            error: String(err),
          }
        );
      }

      toast("OAuth 登录成功");
      logToConsole(
        "info",
        `OAuth 登录成功：${ctx.form.getValues().name || "OAuth Provider"}`,
        {
          cli_key: ctx.cliKey,
          provider_id: targetProviderId,
          provider_type: result.provider_type,
          email: status?.email,
          expires_at: result.expires_at,
          limit_5h: limits?.limit_5h_text,
          limit_weekly: limits?.limit_weekly_text,
        }
      );
      if (!ctx.editingProviderId) {
        ctx.onSaved(ctx.cliKey);
        ctx.onOpenChange(false);
      }
    } else {
      await rollbackAutoSavedProvider();
      toast("OAuth 登录失败");
      logToConsole(
        "warn",
        `OAuth 登录失败：${ctx.form.getValues().name || "OAuth Provider"}`,
        { cli_key: ctx.cliKey, provider_id: targetProviderId }
      );
    }
  } catch (err) {
    await rollbackAutoSavedProvider();
    toast(`OAuth 登录失败：${String(err)}`);
    logToConsole(
      "error",
      `OAuth 登录异常：${ctx.form.getValues().name || "OAuth Provider"}`,
      { cli_key: ctx.cliKey, error: String(err) }
    );
  } finally {
    ctx.setOauthLoading(false);
  }
}

export async function handleOAuthRefresh(ctx: ActionContext) {
  if (!ctx.editingProviderId) return;
  ctx.setOauthLoading(true);
  try {
    const result = await providerOAuthRefresh(ctx.editingProviderId);
    if (result?.success) {
      const status = await providerOAuthStatus(ctx.editingProviderId);
      ctx.setOauthStatus(status);
      toast("Token 刷新成功");
      logToConsole("info", `OAuth Token 刷新成功：${ctx.form.getValues().name}`, {
        provider_id: ctx.editingProviderId,
        expires_at: result.expires_at,
      });
    } else {
      toast("Token 刷新失败");
      logToConsole("warn", `OAuth Token 刷新失败：${ctx.form.getValues().name}`, {
        provider_id: ctx.editingProviderId,
      });
    }
  } catch (err) {
    toast(`Token 刷新失败：${String(err)}`);
    logToConsole("error", `OAuth Token 刷新异常：${ctx.form.getValues().name}`, {
      provider_id: ctx.editingProviderId,
      error: String(err),
    });
  } finally {
    ctx.setOauthLoading(false);
  }
}

export async function handleOAuthDisconnect(ctx: ActionContext) {
  if (!ctx.editingProviderId) return;
  ctx.setOauthLoading(true);
  try {
    const result = await providerOAuthDisconnect(ctx.editingProviderId);
    if (result?.success) {
      ctx.setOauthStatus(null);
      toast("已断开 OAuth 连接");
      logToConsole("info", `OAuth 已断开连接：${ctx.form.getValues().name}`, {
        provider_id: ctx.editingProviderId,
      });
    } else {
      toast("断开 OAuth 连接失败");
      logToConsole("warn", `OAuth 断开连接失败：${ctx.form.getValues().name}`, {
        provider_id: ctx.editingProviderId,
      });
    }
  } catch (err) {
    toast(`断开 OAuth 连接失败：${String(err)}`);
    logToConsole("error", `OAuth 断开连接异常：${ctx.form.getValues().name}`, {
      provider_id: ctx.editingProviderId,
      error: String(err),
    });
  } finally {
    ctx.setOauthLoading(false);
  }
}
