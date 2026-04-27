/**
 * Providers routed via `createOpenAI(...).chat(model)` can map `system` to role `developer`
 * under AI SDK compatibility mode. Some OpenAI-compatible Chat Completions APIs only accept
 * system | user | assistant | tool, so ingestion folds the system prompt into the user message.
 */
const OPENAI_COMPAT_CHAT_PROVIDERS_FOLD_SYSTEM = new Set([
	'aizolo',
	'mistral',
	'groq',
	'deepseek',
	'together',
	'cohere',
	'openrouter',
	'perplexity'
]);

export function shouldFoldSystemPromptIntoUserForProvider(provider: string | undefined): boolean {
	if (!provider) return false;
	const p = provider.toLowerCase();
	if (OPENAI_COMPAT_CHAT_PROVIDERS_FOLD_SYSTEM.has(p)) return true;
	const extractionBase = process.env.EXTRACTION_BASE_URL?.trim().toLowerCase() ?? '';
	// `buildExtractionOpenAiCompatibleRoute` uses `provider: 'openai'` for Fireworks/Together/etc., or
	// `provider: 'vertex'` for `generativelanguage.googleapis.com` (Gemini via OpenAI-compatible Chat Completions). Fireworks
	// deployment templates return 400 ("roles must alternate…") when `system` is sent separately;
	// Together SFT eval defaults to the same folded shape (see `EXTRACTION_EVAL_FOLD_SYSTEM`).
	if (p === 'openai' && extractionBase) {
		if (extractionBase.includes('fireworks.ai') || extractionBase.includes('together.xyz')) {
			return true;
		}
	}
	return false;
}
