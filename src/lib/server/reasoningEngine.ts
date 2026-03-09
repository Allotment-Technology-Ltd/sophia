import { runDialecticalEngine, type EngineCallbacks } from './engine';

export async function runDomainAgnosticReasoning(
  inputText: string,
  callbacks: EngineCallbacks
): Promise<void> {
  await runDialecticalEngine(inputText, callbacks, { mode: 'agnostic' });
}
