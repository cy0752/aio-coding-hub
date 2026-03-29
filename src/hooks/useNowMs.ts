// Usage:
// - Provides a reactive current timestamp in milliseconds.
// - Starts/stops its interval based on `enabled`.
// - Useful for live elapsed-duration UI that should keep ticking while a task is in progress.

import { useEffect, useState } from "react";

export function useNowMs(enabled: boolean, intervalMs = 250): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);

  return nowMs;
}
