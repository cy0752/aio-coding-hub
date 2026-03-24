import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";

vi.mock("../services/frontendErrorReporter", async () => {
  const actual = await vi.importActual<typeof import("../services/frontendErrorReporter")>(
    "../services/frontendErrorReporter"
  );
  return {
    ...actual,
    installGlobalErrorReporting: vi.fn(),
  };
});

let appRoot: Root | null = null;

async function importMainEntry() {
  const mainModule = await import("../main");
  appRoot = mainModule.appRoot;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return mainModule;
}

describe("main entry", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    appRoot?.unmount();
    appRoot = null;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("renders without crashing", async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await importMainEntry();

    expect(document.getElementById("root")?.innerHTML).toBeTruthy();
  });

  it("registers global frontend error handlers", async () => {
    document.body.innerHTML = '<div id="root"></div>';

    const reporter = await import("../services/frontendErrorReporter");
    await importMainEntry();

    expect(reporter.installGlobalErrorReporting).toHaveBeenCalled();
  });
});
