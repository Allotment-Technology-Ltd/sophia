/**
 * Optional throughput tuning when ingestion uses Google Generative (Vertex or
 * Gemini Developer API via the `google` / `vertex` provider labels in plans).
 *
 * Disable with `INGEST_GOOGLE_GENERATIVE_THROUGHPUT=0` if you need conservative defaults.
 */

export function isGoogleGenerativeThroughputEnabled(): boolean {
	const v = (process.env.INGEST_GOOGLE_GENERATIVE_THROUGHPUT ?? '1').trim().toLowerCase();
	return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

/** True when the routed stage uses Vertex ADC or Gemini Developer API (AI SDK `google` → labeled `vertex` in plans). */
export function isGoogleGenerativePlanProvider(provider: string | undefined): boolean {
	const p = (provider ?? '').trim().toLowerCase();
	return p === 'vertex' || p === 'google';
}
