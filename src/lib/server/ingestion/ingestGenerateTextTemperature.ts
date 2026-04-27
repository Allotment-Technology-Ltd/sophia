import type { StageKey } from './stages/types.js';

/**
 * Whether `generateText` should omit `temperature` for this call.
 *
 * OpenAI project / custom deployments under `.../deployments/...` often map to reasoning-style
 * models that reject `temperature` (AI SDK logs `unsupported-setting`). Operators can extend
 * matching via env or disable the deployment heuristic.
 */
export function shouldOmitGenerateTextTemperature(
	stage: StageKey,
	routingProvider: string,
	modelId: string,
	env: NodeJS.ProcessEnv = process.env
): boolean {
	const stagesFilter = (env.INGEST_OMIT_LLM_TEMPERATURE_STAGES ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	const stageOk = stagesFilter.length === 0 || stagesFilter.includes(stage);
	if (!stageOk) return false;

	const g = (env.INGEST_OMIT_LLM_TEMPERATURE ?? '').trim().toLowerCase();
	if (g === '1' || g === 'true' || g === 'yes') return true;

	const mid = modelId.toLowerCase();
	const subStrs = (env.INGEST_OMIT_LLM_TEMPERATURE_MODEL_SUBSTRINGS ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	for (const s of subStrs) {
		if (s && mid.includes(s)) return true;
	}

	const prov = routingProvider.trim().toLowerCase();
	const disableDeploy =
		(env.INGEST_DISABLE_OPENAI_DEPLOYMENT_TEMPERATURE_OMIT ?? '').trim() === '1';
	if (!disableDeploy && prov === 'openai' && /\/deployments\//i.test(mid)) {
		return true;
	}

	// Vertex / Google AI and AiZolo-carried Gemini 3 preview models use a reasoning-style
	// surface and reject temperature.
	if ((prov === 'vertex' || prov === 'google' || prov === 'aizolo') && /\bgemini-3/i.test(mid)) {
		return true;
	}

	return false;
}
