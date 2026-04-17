import { describe, expect, it, vi } from "vitest";
import { invokeServiceCommand } from "../invokeServiceCommand";
import { logToConsole } from "../consoleLog";
import { invokeTauriOrNull } from "../tauriInvoke";

vi.mock("../consoleLog", async () => {
  const actual = await vi.importActual<typeof import("../consoleLog")>("../consoleLog");
  return {
    ...actual,
    logToConsole: vi.fn(),
  };
});

vi.mock("../tauriInvoke", () => ({
  invokeTauriOrNull: vi.fn(),
}));

describe("services/invokeServiceCommand", () => {
  it("returns fallback when a void tauri command resolves to null", async () => {
    vi.mocked(invokeTauriOrNull).mockResolvedValueOnce(null);

    const result = await invokeServiceCommand<void>({
      title: "代理连接测试失败",
      cmd: "gateway_upstream_proxy_test",
      args: { proxyUrl: "http://127.0.0.1:7890" },
      nullResultBehavior: "return_fallback",
    });

    expect(result).toBeNull();
  });

  it("redacts proxy credentials from args and details before logging", async () => {
    vi.mocked(invokeTauriOrNull).mockRejectedValueOnce(new Error("boom"));

    await expect(
      invokeServiceCommand<void>({
        title: "代理连接测试失败",
        cmd: "gateway_upstream_proxy_test",
        args: {
          proxyUrl: "http://inline:secret@127.0.0.1:7890",
          proxyPassword: "secret",
        },
        details: {
          proxyUrl: "http://inline:secret@127.0.0.1:7890",
        },
      })
    ).rejects.toThrow("boom");

    expect(logToConsole).toHaveBeenCalledWith("error", "代理连接测试失败", {
      cmd: "gateway_upstream_proxy_test",
      args: {
        proxyUrl: "http://127.0.0.1:7890",
        proxyPassword: "[REDACTED]",
      },
      proxyUrl: "http://127.0.0.1:7890",
      error: "boom",
    });
  });

  it("redacts various sensitive key patterns", async () => {
    vi.mocked(invokeTauriOrNull).mockRejectedValueOnce(new Error("fail"));

    await expect(
      invokeServiceCommand<void>({
        title: "test",
        cmd: "test_cmd",
        args: {
          api_key: "sk-xxx",
          apiKey: "sk-yyy",
          access_token: "at-xxx",
          refresh_token: "rt-xxx",
          client_secret: "cs-xxx",
          auth_token: "auth-xxx",
          bearer_token: "bearer-xxx",
          session_token: "sess-xxx",
          private_key: "pk-xxx",
          password: "pw-xxx",
          secret: "sec-xxx",
          token: "tok-xxx",
          authorization: "auth-xxx",
          credential: "cred-xxx",
        },
      })
    ).rejects.toThrow("fail");

    expect(logToConsole).toHaveBeenCalledWith("error", "test", {
      cmd: "test_cmd",
      args: {
        api_key: "[REDACTED]",
        apiKey: "[REDACTED]",
        access_token: "[REDACTED]",
        refresh_token: "[REDACTED]",
        client_secret: "[REDACTED]",
        auth_token: "[REDACTED]",
        bearer_token: "[REDACTED]",
        session_token: "[REDACTED]",
        private_key: "[REDACTED]",
        password: "[REDACTED]",
        secret: "[REDACTED]",
        token: "[REDACTED]",
        authorization: "[REDACTED]",
        credential: "[REDACTED]",
      },
      error: "fail",
    });
  });

  it("does not redact non-sensitive keys that may contain similar substrings", async () => {
    vi.mocked(invokeTauriOrNull).mockRejectedValueOnce(new Error("fail"));

    await expect(
      invokeServiceCommand<void>({
        title: "test",
        cmd: "test_cmd",
        args: {
          quotaToken: "qt-xxx",
          idempotencyToken: "it-xxx",
          providerName: "anthropic",
          model: "claude-3",
          baseUrl: "https://api.example.com",
        },
      })
    ).rejects.toThrow("fail");

    expect(logToConsole).toHaveBeenCalledWith("error", "test", {
      cmd: "test_cmd",
      args: {
        quotaToken: "qt-xxx",
        idempotencyToken: "it-xxx",
        providerName: "anthropic",
        model: "claude-3",
        baseUrl: "https://api.example.com",
      },
      error: "fail",
    });
  });
});
