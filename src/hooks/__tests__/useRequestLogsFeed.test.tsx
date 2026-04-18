import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gatewayEventNames } from "../../constants/gatewayEvents";
import { useRequestLogsFeed } from "../useRequestLogsFeed";
import {
  useRequestLogsIncrementalRefreshMutation,
  useRequestLogsListAllQuery,
} from "../../query/requestLogs";
import { subscribeGatewayEvent } from "../../services/gateway/gatewayEventBus";
import { useDocumentVisibility } from "../useDocumentVisibility";
import { useWindowForeground } from "../useWindowForeground";

vi.mock("../../query/requestLogs", () => ({
  useRequestLogsListAllQuery: vi.fn(),
  useRequestLogsIncrementalRefreshMutation: vi.fn(),
}));

vi.mock("../../services/gateway/gatewayEventBus", () => ({
  subscribeGatewayEvent: vi.fn(),
}));

vi.mock("../useDocumentVisibility", () => ({
  useDocumentVisibility: vi.fn(),
}));

vi.mock("../useWindowForeground", () => ({
  useWindowForeground: vi.fn(),
}));

describe("hooks/useRequestLogsFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(useDocumentVisibility).mockReturnValue(true);
    vi.mocked(useRequestLogsIncrementalRefreshMutation).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(null),
      isPending: false,
    } as any);
    vi.mocked(subscribeGatewayEvent).mockReturnValue({
      ready: Promise.resolve(),
      unsubscribe: vi.fn(),
    });
  });

  it("disables live subscription and foreground refresh when the feed is disabled", () => {
    const requestRefetch = vi.fn();

    vi.mocked(useRequestLogsListAllQuery).mockReturnValue({
      data: null,
      isLoading: true,
      isFetching: false,
      refetch: requestRefetch,
    } as any);

    const { result } = renderHook(() =>
      useRequestLogsFeed({
        limit: 20,
        enabled: false,
        liveUpdatesEnabled: true,
        liveUpdateIntervalMs: 1500,
        refreshOnForeground: true,
      })
    );

    expect(subscribeGatewayEvent).not.toHaveBeenCalled();
    expect(useWindowForeground).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
      })
    );
    expect(result.current.requestLogs).toEqual([]);
    expect(result.current.requestLogsLoading).toBe(true);
    expect(result.current.requestLogsAvailable).toBeNull();

    act(() => {
      void result.current.refreshRequestLogs();
    });
    expect(requestRefetch).toHaveBeenCalledTimes(1);
  });

  it("subscribes to request signals and coalesces complete events into incremental refreshes", async () => {
    vi.useFakeTimers();
    const requestRefetch = vi.fn();
    const incrementalRefresh = vi.fn().mockResolvedValue(null);
    let eventHandler: ((payload: { phase: "start" | "complete" }) => void) | null = null;

    vi.mocked(useRequestLogsListAllQuery).mockReturnValue({
      data: [{ id: 1 }],
      isLoading: false,
      isFetching: false,
      refetch: requestRefetch,
    } as any);
    vi.mocked(useRequestLogsIncrementalRefreshMutation).mockReturnValue({
      mutateAsync: incrementalRefresh,
      isPending: true,
    } as any);
    vi.mocked(subscribeGatewayEvent).mockImplementation((event: string, handler: any) => {
      expect(event).toBe(gatewayEventNames.requestSignal);
      eventHandler = handler;
      return {
        ready: Promise.resolve(),
        unsubscribe: vi.fn(),
      };
    });

    const { result } = renderHook(() =>
      useRequestLogsFeed({
        limit: 10,
        liveUpdatesEnabled: true,
        liveUpdateIntervalMs: 2500,
        refreshOnForeground: true,
      })
    );

    expect(result.current.requestLogsRefreshing).toBe(true);
    expect(result.current.requestLogsAvailable).toBe(true);
    expect(subscribeGatewayEvent).toHaveBeenCalledTimes(1);

    act(() => {
      eventHandler?.({ phase: "start" });
      eventHandler?.({ phase: "complete" });
      eventHandler?.({ phase: "complete" });
    });

    expect(incrementalRefresh).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    expect(incrementalRefresh).toHaveBeenCalledTimes(1);
    expect(requestRefetch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("refreshes through incremental mutation on foreground when live updates own freshness", () => {
    const incrementalRefresh = vi.fn().mockResolvedValue(null);
    let foregroundArgs: { onForeground: () => void } | null = null;

    vi.mocked(useRequestLogsListAllQuery).mockReturnValue({
      data: [{ id: 1 }],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as any);
    vi.mocked(useRequestLogsIncrementalRefreshMutation).mockReturnValue({
      mutateAsync: incrementalRefresh,
      isPending: false,
    } as any);
    vi.mocked(useWindowForeground).mockImplementation((args: any) => {
      foregroundArgs = args;
    });

    renderHook(() =>
      useRequestLogsFeed({
        limit: 10,
        liveUpdatesEnabled: true,
        refreshOnForeground: true,
      })
    );

    act(() => {
      foregroundArgs?.onForeground();
    });

    expect(incrementalRefresh).not.toHaveBeenCalled();
  });

  it("refreshes the list query on foreground when live updates are off", () => {
    const requestRefetch = vi.fn();
    let foregroundArgs: { onForeground: () => void } | null = null;

    vi.mocked(useRequestLogsListAllQuery).mockReturnValue({
      data: [{ id: 1 }],
      isLoading: false,
      isFetching: true,
      refetch: requestRefetch,
    } as any);
    vi.mocked(useWindowForeground).mockImplementation((args: any) => {
      foregroundArgs = args;
    });

    const { result } = renderHook(() =>
      useRequestLogsFeed({
        limit: 10,
        liveUpdatesEnabled: false,
        refreshOnForeground: true,
      })
    );

    expect(result.current.requestLogsRefreshing).toBe(true);

    act(() => {
      foregroundArgs?.onForeground();
    });

    expect(requestRefetch).toHaveBeenCalledTimes(1);
  });

  it("pauses live subscription when the document is hidden even if live updates are enabled", () => {
    vi.mocked(useDocumentVisibility).mockReturnValue(false);
    vi.mocked(useRequestLogsListAllQuery).mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as any);

    const { result } = renderHook(() =>
      useRequestLogsFeed({
        limit: 30,
        liveUpdatesEnabled: true,
        liveUpdateIntervalMs: 3000,
        refreshOnForeground: true,
      })
    );

    expect(subscribeGatewayEvent).not.toHaveBeenCalled();
    expect(result.current.requestLogsRefreshing).toBe(false);
    expect(result.current.requestLogsAvailable).toBe(false);
  });
});
