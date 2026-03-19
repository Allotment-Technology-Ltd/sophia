import { runDialecticalEngine, type EngineCallbacks } from './engine';
import type { ProviderApiKeys } from './byok/types';

export async function runDomainAgnosticReasoning(
  inputText: string,
  callbacks: EngineCallbacks,
  options?: { providerApiKeys?: ProviderApiKeys }
): Promise<void> {
  await runDialecticalEngine(inputText, callbacks, {
    mode: 'agnostic',
    routeId: process.env.RESTORMEL_VERIFY_ROUTE_ID?.trim() || undefined,
    providerApiKeys: options?.providerApiKeys
  });
}
