/**
 * Google AI Studio Gemini access via the OpenAI-compatible Chat Completions API
 * (same base URL as `GOOGLE_AI_STUDIO_OPENAI_BASE_URL` in `src/lib/server/vertex.ts`).
 *
 * Defined here so scripts avoid importing `vertex.ts` (heavy server graph under `tsx`).
 */

export const GOOGLE_AI_STUDIO_OPENAI_BASE_URL =
	'https://generativelanguage.googleapis.com/v1beta/openai';

export async function googleAiStudioOpenAiChatCompletion(options: {
	apiKey: string;
	model: string;
	userMessage: string;
	temperature?: number;
	maxTokens?: number;
}): Promise<{ text: string; usage?: { promptTokens?: number; completionTokens?: number } }> {
	const url = `${GOOGLE_AI_STUDIO_OPENAI_BASE_URL}/chat/completions`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${options.apiKey.trim()}`
		},
		body: JSON.stringify({
			model: options.model,
			messages: [{ role: 'user', content: options.userMessage }],
			temperature: options.temperature ?? 0.1,
			max_tokens: options.maxTokens ?? 256
		})
	});

	const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	if (!res.ok) {
		throw new Error(`OpenAI-compat Gemini HTTP ${res.status}: ${JSON.stringify(raw)}`);
	}

	const choices = raw?.choices as Array<{ message?: { content?: unknown } }> | undefined;
	const content = choices?.[0]?.message?.content;
	const text =
		typeof content === 'string' ? content : String(content ?? '');

	const usage = raw?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
	return {
		text,
		usage: usage
			? {
					promptTokens: usage.prompt_tokens,
					completionTokens: usage.completion_tokens
				}
			: undefined
	};
}
