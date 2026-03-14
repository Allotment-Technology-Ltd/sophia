import { z } from 'zod';

export const RESTORMEL_CONTRACTS_SCHEMA_VERSION = 1 as const;

export const RestormelContractsSchemaVersionSchema = z.literal(
  RESTORMEL_CONTRACTS_SCHEMA_VERSION
);

export type RestormelContractsSchemaVersion = typeof RESTORMEL_CONTRACTS_SCHEMA_VERSION;
