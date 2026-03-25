export const appEventNames = {
  heartbeat: "app:heartbeat",
  notice: "notice:notify",
} as const;

export type AppEventName = (typeof appEventNames)[keyof typeof appEventNames];
