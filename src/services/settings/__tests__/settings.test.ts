import { beforeEach, describe, expect, it, vi } from "vitest";
import { tauriInvoke } from "../../../test/mocks/tauri";
import { createTestAppSettings } from "../../../test/fixtures/settings";
import { setTauriRuntime } from "../../../test/utils/tauriRuntime";

describe("services/settings/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes update as a single named parameter", async () => {
    setTauriRuntime();
    vi.resetModules();
    vi.mocked(tauriInvoke).mockResolvedValue({ schema_version: 1 } as any);

    const { settingsSet } = await import("../settings");

    await settingsSet({
      preferredPort: 37123,
      showHomeHeatmap: false,
      showHomeUsage: true,
      homeUsagePeriod: "last7",
      cliPriorityOrder: ["codex", "claude", "gemini"],
      autoStart: false,
      trayEnabled: true,
      logRetentionDays: 30,
      providerCooldownSeconds: 30,
      providerBaseUrlPingCacheTtlSeconds: 60,
      upstreamFirstByteTimeoutSeconds: 0,
      upstreamStreamIdleTimeoutSeconds: 0,
      upstreamRequestTimeoutNonStreamingSeconds: 0,
      failoverMaxAttemptsPerProvider: 5,
      failoverMaxProvidersToTry: 5,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerOpenDurationMinutes: 30,
    });

    expect(tauriInvoke).toHaveBeenCalledWith(
      "settings_set",
      expect.objectContaining({
        update: expect.objectContaining({
          preferredPort: 37123,
          showHomeHeatmap: false,
          showHomeUsage: true,
          homeUsagePeriod: "last7",
          cliPriorityOrder: ["codex", "claude", "gemini"],
          autoStart: false,
        }),
      })
    );

    vi.mocked(tauriInvoke).mockClear();

    await settingsSet({
      preferredPort: 37123,
      gatewayListenMode: "custom",
      gatewayCustomListenAddress: "0.0.0.0:37123",
      autoStart: false,
      trayEnabled: true,
      logRetentionDays: 30,
      providerCooldownSeconds: 30,
      providerBaseUrlPingCacheTtlSeconds: 60,
      upstreamFirstByteTimeoutSeconds: 0,
      upstreamStreamIdleTimeoutSeconds: 0,
      upstreamRequestTimeoutNonStreamingSeconds: 0,
      interceptAnthropicWarmupRequests: true,
      enableThinkingSignatureRectifier: false,
      enableResponseFixer: true,
      responseFixerFixEncoding: true,
      responseFixerFixSseFormat: false,
      responseFixerFixTruncatedJson: true,
      cliPriorityOrder: ["gemini", "claude", "codex"],
      enableCacheAnomalyMonitor: true,
      updateReleasesUrl: "https://example.invalid/releases.json",
      failoverMaxAttemptsPerProvider: 5,
      failoverMaxProvidersToTry: 5,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerOpenDurationMinutes: 30,
      wslAutoConfig: true,
      wslTargetCli: { claude: true, codex: false, gemini: true },
      codexHomeOverride: "D:\\CodexHome",
    } as any);

    expect(tauriInvoke).toHaveBeenCalledWith(
      "settings_set",
      expect.objectContaining({
        update: expect.objectContaining({
          gatewayListenMode: "custom",
          gatewayCustomListenAddress: "0.0.0.0:37123",
          interceptAnthropicWarmupRequests: true,
          enableThinkingSignatureRectifier: false,
          enableCacheAnomalyMonitor: true,
          enableResponseFixer: true,
          responseFixerFixEncoding: true,
          responseFixerFixSseFormat: false,
          responseFixerFixTruncatedJson: true,
          cliPriorityOrder: ["gemini", "claude", "codex"],
          updateReleasesUrl: "https://example.invalid/releases.json",
          wslAutoConfig: true,
          wslTargetCli: { claude: true, codex: false, gemini: true },
          codexHomeOverride: "D:\\CodexHome",
        }),
      })
    );
  });

  it("maps cached settings back into the generated update contract", async () => {
    const { createSettingsSetInput } = await import("../settings");

    const input = createSettingsSetInput(createTestAppSettings(), {
      upstream_proxy_password: { mode: "clear" },
    });

    expect(input).toMatchObject({
      preferredPort: 37123,
      gatewayListenMode: "localhost",
      wslTargetCli: { claude: true, codex: true, gemini: true },
      cx2CcFallbackModelMain: "gpt-5.4",
      upstreamProxyPassword: { mode: "clear" },
    });
    expect(input).not.toHaveProperty("cx2ccFallbackModelMain");
  });

  it("prefers generated update keys over cached settings when patching cx2cc fields", async () => {
    const { createSettingsSetInput } = await import("../settings");

    const input = createSettingsSetInput(createTestAppSettings(), {
      cx2CcModelReasoningEffort: "high",
      cx2CcDisableResponseStorage: false,
    });

    expect(input).toMatchObject({
      cx2CcModelReasoningEffort: "high",
      cx2CcDisableResponseStorage: false,
    });
  });

  it("applies snake_case cx2cc patch keys when building input from current settings", async () => {
    const { createSettingsSetInput } = await import("../settings");

    const input = createSettingsSetInput(createTestAppSettings(), {
      cx2cc_model_reasoning_effort: "xhigh",
      cx2cc_service_tier: "fast",
      cx2cc_disable_response_storage: false,
      cx2cc_enable_reasoning_to_thinking: false,
      cx2cc_drop_stop_sequences: false,
      cx2cc_clean_schema: false,
      cx2cc_filter_batch_tool: false,
    } as any);

    expect(input).toMatchObject({
      cx2CcModelReasoningEffort: "xhigh",
      cx2CcServiceTier: "fast",
      cx2CcDisableResponseStorage: false,
      cx2CcEnableReasoningToThinking: false,
      cx2CcDropStopSequences: false,
      cx2CcCleanSchema: false,
      cx2CcFilterBatchTool: false,
    });
  });
});
