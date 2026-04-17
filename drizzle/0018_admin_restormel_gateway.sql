-- Operator-configured Restormel Keys gateway API key (AES-GCM payload in app layer; see `restormelGatewaySettings.ts`).
-- When absent, `RESTORMEL_GATEWAY_KEY` env is used (deploy / CLI).

CREATE TABLE IF NOT EXISTS admin_restormel_gateway (
  id text PRIMARY KEY CHECK (id = 'default'),
  gateway_key_encrypted jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_uid text
);

COMMENT ON TABLE admin_restormel_gateway IS 'Encrypted Restormel Keys gateway bearer (rk_…); env RESTORMEL_GATEWAY_KEY when row missing or null.';
