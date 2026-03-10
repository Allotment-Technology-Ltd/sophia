function parseBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return defaultValue;
}

export const BILLING_FEATURE_ENABLED = parseBooleanFlag(
  process.env.ENABLE_BILLING,
  true
);

export const INGEST_VISIBILITY_MODE_ENABLED = parseBooleanFlag(
  process.env.ENABLE_INGEST_VISIBILITY_MODE,
  true
);

export const BYOK_WALLET_CHARGING_ENABLED = parseBooleanFlag(
  process.env.ENABLE_BYOK_WALLET_CHARGING,
  false
);

export const BYOK_WALLET_SHADOW_MODE = parseBooleanFlag(
  process.env.BYOK_WALLET_SHADOW_MODE,
  true
);
