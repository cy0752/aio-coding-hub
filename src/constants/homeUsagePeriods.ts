export const HOME_USAGE_PERIOD_VALUES = ["last7", "last15", "last30", "month"] as const;

export type HomeUsagePeriod = (typeof HOME_USAGE_PERIOD_VALUES)[number];
