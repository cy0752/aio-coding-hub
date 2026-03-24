import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsUpdateCard } from "../SettingsUpdateCard";

describe("pages/settings/SettingsUpdateCard", () => {
  it("renders portable mode action and triggers open update flow", () => {
    const checkUpdate = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsUpdateCard
        about={{ run_mode: "portable" } as any}
        checkingUpdate={false}
        checkUpdate={checkUpdate}
      />
    );

    expect(screen.getByText("获取新版本")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    expect(checkUpdate).toHaveBeenCalledTimes(1);
  });

  it("renders standard update controls and disables the action when unavailable or busy", () => {
    const checkUpdate = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <SettingsUpdateCard about={null} checkingUpdate={false} checkUpdate={checkUpdate} />
    );

    expect(screen.getByText("检查更新")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查" })).toBeDisabled();

    view.rerender(
      <SettingsUpdateCard
        about={{ run_mode: "installed" } as any}
        checkingUpdate
        checkUpdate={checkUpdate}
      />
    );

    expect(screen.getByRole("button", { name: "检查中…" })).toBeDisabled();
    expect(checkUpdate).not.toHaveBeenCalled();
  });
});
