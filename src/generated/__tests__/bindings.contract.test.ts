import { describe, expect, it } from "vitest";
import { appEventNames } from "../../constants/appEvents";
import { HOME_USAGE_PERIOD_VALUES } from "../../constants/homeUsagePeriods";
import bindingsSource from "../bindings.ts?raw";
import heartbeatSource from "../../../src-tauri/src/app/heartbeat_watchdog.rs?raw";
import noticeSource from "../../../src-tauri/src/app/notice.rs?raw";

function extractStringUnionLiterals(source: string, typeName: string) {
  const match = source.match(new RegExp(`export type ${typeName} = (.+)$`, "m"));
  expect(match).toBeTruthy();
  return Array.from(match![1].matchAll(/"([^"]+)"/g), (item) => item[1]);
}

function extractRustStringConst(source: string, constName: string) {
  const match = source.match(new RegExp(`const ${constName}: &str = "([^"]+)";`));
  expect(match).toBeTruthy();
  return match![1];
}

describe("generated/bindings.ts contract", () => {
  it("documents that the generated bindings cover only a partial IPC surface", () => {
    expect(bindingsSource).toContain("NOTE: Partial IPC contract only.");
    expect(bindingsSource).toContain("settings_get");
    expect(bindingsSource).toContain("provider_upsert");
  });

  it("exports the home usage period literals used by runtime settings", () => {
    expect(extractStringUnionLiterals(bindingsSource, "HomeUsagePeriod")).toEqual([
      ...HOME_USAGE_PERIOD_VALUES,
    ]);
    expect(bindingsSource).not.toContain('"last_7"');
    expect(bindingsSource).not.toContain('"last_15"');
    expect(bindingsSource).not.toContain('"last_30"');
  });

  it("includes upstream proxy settings in the generated settings contract", () => {
    expect(bindingsSource).toContain("upstream_proxy_enabled");
    expect(bindingsSource).toContain("upstream_proxy_url");
    expect(bindingsSource).toContain("upstream_proxy_username");
    expect(bindingsSource).toContain("upstream_proxy_password");
    expect(bindingsSource).toContain("upstreamProxyEnabled");
    expect(bindingsSource).toContain("upstreamProxyUrl");
    expect(bindingsSource).toContain("upstreamProxyUsername");
    expect(bindingsSource).toContain("upstreamProxyPassword");
  });

  it("keeps Rust app event emitters aligned with shared frontend constants", () => {
    expect(extractRustStringConst(heartbeatSource, "HEARTBEAT_EVENT_NAME")).toBe(
      appEventNames.heartbeat
    );
    expect(extractRustStringConst(noticeSource, "NOTICE_EVENT_NAME")).toBe(appEventNames.notice);
  });
});
