import { useCallback, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { ClaudeModels, ProviderSummary } from "../../services/providers/providers";
import type { ProviderEditorDialogFormInput } from "../../schemas/providerEditorDialog";
import type { BaseUrlRow, ProviderBaseUrlMode } from "./types";
import type { ProviderEditorDialogProps } from "./ProviderEditorDialog";
import type { ActionContext } from "./providerEditorActionContext";
import {
  DEFAULT_FORM_VALUES,
  CX2CC_GLOBAL_SOURCE_VALUE,
  deriveAuthMode,
  deriveCx2ccSourceValue,
  cliNameFromKey,
} from "./providerEditorUtils";
import {
  save as saveAction,
  copyApiKey as copyApiKeyAction,
} from "./useProviderEditorActions";
import {
  handleOAuthLogin as oauthLoginAction,
  handleOAuthRefresh as oauthRefreshAction,
  handleOAuthDisconnect as oauthDisconnectAction,
} from "./providerEditorOAuthActions";
import { useProviderEditorEffects } from "./useProviderEditorEffects";

export function useProviderEditorForm(props: ProviderEditorDialogProps) {
  const { open, onOpenChange, onSaved, codexProviders = [] } = props;

  const mode = props.mode;
  const cliKey = mode === "create" ? props.cliKey : props.provider.cli_key;
  const createInitialValues = mode === "create" ? (props.initialValues ?? null) : null;
  const isDuplicating = mode === "create" && createInitialValues != null;
  const editingProviderId = mode === "edit" ? props.provider.id : null;
  const editProvider = mode === "edit" ? props.provider : null;

  const baseUrlRowSeqRef = useRef(1);
  const newBaseUrlRow = (url = ""): BaseUrlRow => {
    const id = String(baseUrlRowSeqRef.current++);
    return { id, url, ping: { status: "idle" } };
  };

  const [baseUrlMode, setBaseUrlMode] = useState<ProviderBaseUrlMode>("order");
  const [baseUrlRows, setBaseUrlRows] = useState<BaseUrlRow[]>(() => [newBaseUrlRow()]);
  const [pingingAll, setPingingAll] = useState(false);
  const [claudeModels, setClaudeModels] = useState<ClaudeModels>({});
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [streamIdleTimeoutSeconds, setStreamIdleTimeoutSeconds] = useState("");
  const [saving, setSaving] = useState(false);
  const [fetchingApiKey, setFetchingApiKey] = useState(false);
  const [savedApiKey, setSavedApiKey] = useState<string | null>(null);
  const apiKeyFetchedRef = useRef(false);
  const apiKeyFetchPromiseRef = useRef<Promise<string | null> | null>(null);
  const apiKeyFetchErrorRef = useRef(false);
  const apiKeyRequestSeqRef = useRef(0);

  const [authMode, setAuthMode] = useState<"api_key" | "oauth" | "cx2cc">(
    deriveAuthMode(editProvider)
  );
  const [cx2ccSourceValue, setCx2ccSourceValue] = useState<string>(
    deriveCx2ccSourceValue(editProvider)
  );
  const [oauthStatus, setOauthStatus] = useState<ActionContext["oauthStatus"]>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [cx2ccFallbackModels, setCx2ccFallbackModels] = useState<{
    main: string; haiku: string; sonnet: string; opus: string;
  } | null>(null);
  const [codexGatewayBaseOrigin, setCodexGatewayBaseOrigin] = useState<string | null>(null);
  const oauthStatusRequestSeqRef = useRef(0);

  const form = useForm<ProviderEditorDialogFormInput>({ defaultValues: DEFAULT_FORM_VALUES });
  const editProviderSnapshotRef = useRef<ProviderSummary | null>(null);

  const { register, reset, setValue, watch, formState } = form;
  const enabled = watch("enabled");
  const dailyResetMode = watch("daily_reset_mode");
  const limit5hUsd = watch("limit_5h_usd");
  const limitDailyUsd = watch("limit_daily_usd");
  const limitWeeklyUsd = watch("limit_weekly_usd");
  const limitMonthlyUsd = watch("limit_monthly_usd");
  const limitTotalUsd = watch("limit_total_usd");
  const apiKeyValue = watch("api_key");
  const costMultiplierValue = watch("cost_multiplier");
  const apiKeyDirty = Boolean(formState.dirtyFields.api_key);
  const isCodexGatewaySource = cx2ccSourceValue === CX2CC_GLOBAL_SOURCE_VALUE;
  const sourceProviderId =
    cx2ccSourceValue && cx2ccSourceValue !== CX2CC_GLOBAL_SOURCE_VALUE
      ? Number(cx2ccSourceValue)
      : null;
  const selectedCx2ccSourceProvider = sourceProviderId
    ? (codexProviders.find((provider) => provider.id === sourceProviderId) ?? null)
    : null;
  const codexGatewayBaseUrl = codexGatewayBaseOrigin
    ? `${codexGatewayBaseOrigin.replace(/\/$/, "")}/v1`
    : "当前网关 /v1";

  const title =
    mode === "create"
      ? `${cliNameFromKey(cliKey)} · ${isDuplicating ? "复制供应商" : "添加供应商"}`
      : `${cliNameFromKey(props.provider.cli_key)} · 编辑供应商`;
  const description =
    mode === "create"
      ? isDuplicating
        ? "已复制现有 Provider 配置；CLI 已锁定，请确认名称和认证信息后保存。"
        : "已锁定创建 CLI；如需切换请先关闭弹窗。"
      : undefined;

  useProviderEditorEffects({
    open, mode, cliKey, editProvider, editingProviderId, createInitialValues,
    authMode, costMultiplierValue, isCodexGatewaySource, selectedCx2ccSourceProvider,
    reset, setValue,
    editProviderSnapshotRef, baseUrlRowSeqRef, apiKeyFetchedRef, apiKeyFetchPromiseRef,
    apiKeyFetchErrorRef, apiKeyRequestSeqRef, oauthStatusRequestSeqRef,
    newBaseUrlRow,
    setBaseUrlMode, setBaseUrlRows, setPingingAll, setClaudeModels, setTags, setTagInput,
    setStreamIdleTimeoutSeconds, setAuthMode, setCx2ccSourceValue, setOauthStatus,
    setOauthLoading, setFetchingApiKey, setSavedApiKey, setCx2ccFallbackModels,
    setCodexGatewayBaseOrigin,
  });

  const apiKeyFieldReg = register("api_key");

  const claudeModelCount =
    cliKey === "claude"
      ? Object.values(claudeModels).filter((value) => {
          if (typeof value !== "string") return false;
          return Boolean(value.trim());
        }).length
      : 0;
  const supportsOAuth = cliKey === "codex" || cliKey === "gemini";
  const supportsCx2cc = cliKey === "claude";

  const buildCtx = useCallback((): ActionContext => ({
    mode, cliKey, editingProviderId, editProvider,
    open, onOpenChange, onSaved,
    saving, setSaving,
    authMode, oauthStatus, setOauthStatus, oauthLoading, setOauthLoading,
    cx2ccSourceValue, isCodexGatewaySource, sourceProviderId, selectedCx2ccSourceProvider,
    baseUrlMode, baseUrlRows, tags, claudeModels, streamIdleTimeoutSeconds,
    apiKeyDirty, apiKeyValue, savedApiKey, setSavedApiKey,
    fetchingApiKey, setFetchingApiKey,
    apiKeyFetchedRef, apiKeyFetchPromiseRef, apiKeyFetchErrorRef,
    form: { getValues: form.getValues, setValue: form.setValue },
  }), [
    mode, cliKey, editingProviderId, editProvider, open, onOpenChange, onSaved,
    saving, authMode, oauthStatus, oauthLoading, cx2ccSourceValue, isCodexGatewaySource,
    sourceProviderId, selectedCx2ccSourceProvider, baseUrlMode, baseUrlRows, tags,
    claudeModels, streamIdleTimeoutSeconds, apiKeyDirty, apiKeyValue, savedApiKey,
    fetchingApiKey, form.getValues, form.setValue,
  ]);

  return {
    mode, cliKey, open, onOpenChange,
    saving, title, description,
    authMode, setAuthMode, supportsOAuth, supportsCx2cc,
    register, setValue, watch,
    enabled, dailyResetMode,
    limit5hUsd, limitDailyUsd, limitWeeklyUsd, limitMonthlyUsd, limitTotalUsd,
    costMultiplierValue,
    apiKeyField: apiKeyFieldReg, fetchingApiKey,
    tags, setTags, tagInput, setTagInput,
    baseUrlMode, setBaseUrlMode, baseUrlRows, setBaseUrlRows,
    pingingAll, setPingingAll, newBaseUrlRow,
    claudeModels, setClaudeModels, claudeModelCount,
    streamIdleTimeoutSeconds, setStreamIdleTimeoutSeconds,
    oauthStatus, oauthLoading,
    cx2ccSourceValue, setCx2ccSourceValue,
    isCodexGatewaySource, selectedCx2ccSourceProvider,
    codexGatewayBaseUrl, cx2ccFallbackModels, codexProviders,
    save: () => saveAction(buildCtx()),
    copyApiKey: () => copyApiKeyAction(buildCtx()),
    handleOAuthLogin: () => oauthLoginAction(buildCtx()),
    handleOAuthRefresh: () => oauthRefreshAction(buildCtx()),
    handleOAuthDisconnect: () => oauthDisconnectAction(buildCtx()),
  };
}

export type UseProviderEditorFormReturn = ReturnType<typeof useProviderEditorForm>;
