import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "./msw/server";
import { resetMswState } from "./msw/state";
import { resetTauriEventListeners } from "./mocks/tauri";

const localStorageStore = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return localStorageStore.size;
  },
  clear() {
    localStorageStore.clear();
  },
  getItem(key: string) {
    return localStorageStore.get(String(key)) ?? null;
  },
  key(index: number) {
    return Array.from(localStorageStore.keys())[index] ?? null;
  },
  removeItem(key: string) {
    localStorageStore.delete(String(key));
  },
  setItem(key: string, value: string) {
    localStorageStore.set(String(key), String(value));
  },
};

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  type Size = { width: number; height: number };
  type ResponsiveChildren = ReactNode | ((size: Size) => ReactNode);
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ResponsiveChildren }) =>
      createElement(
        "div",
        { style: { width: 400, height: 300 } },
        typeof children === "function"
          ? (children as (size: Size) => ReactNode)({ width: 400, height: 300 })
          : children
      ),
  };
});

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Mock window.matchMedia for responsive hooks
// Use a plain function (not vi.fn) to avoid being cleared by vi.clearAllMocks()
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {}, // deprecated
    removeListener: () => {}, // deprecated
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

afterEach(() => {
  cleanup();
  resetMswState();
  server.resetHandlers();
  resetTauriEventListeners();
  delete (window as any).__TAURI_INTERNALS__;
  vi.clearAllMocks();
});

beforeAll(() => {
  server.listen({ onUnhandledRequest: "warn" });
});

afterAll(() => {
  server.close();
});
