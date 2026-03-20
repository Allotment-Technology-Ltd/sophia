/**
 * Reference catalog for ingestion operators. Labels must match chain selects (`provider · modelId`).
 * Tiers are relative (market moves); use for comparison, not billing.
 */

export type IngestionCostTier = 'low' | 'medium' | 'high';
export type IngestionQualityTier = 'capable' | 'strong' | 'frontier';
export type IngestionSpeedTier = 'fast' | 'balanced' | 'thorough';

export interface IngestionModelCatalogEntry {
	label: string;
	provider: string;
	modelId: string;
	costTier: IngestionCostTier;
	qualityTier: IngestionQualityTier;
	speed: IngestionSpeedTier;
	contextWindow: string;
	/** One line: what this model is usually best for in extraction-style work */
	bestFor: string;
}

export const INGESTION_MODEL_CATALOG: IngestionModelCatalogEntry[] = [
	{
		label: 'anthropic · claude-3-5-haiku-20241022',
		provider: 'anthropic',
		modelId: 'claude-3-5-haiku-20241022',
		costTier: 'low',
		qualityTier: 'capable',
		speed: 'fast',
		contextWindow: '200k',
		bestFor: 'High-volume or budget runs; good structure, lighter reasoning than Sonnet.'
	},
	{
		label: 'anthropic · claude-3-5-sonnet-20241022',
		provider: 'anthropic',
		modelId: 'claude-3-5-sonnet-20241022',
		costTier: 'medium',
		qualityTier: 'strong',
		speed: 'balanced',
		contextWindow: '200k',
		bestFor: 'Default balance of accuracy and cost for SEP-style articles and clean HTML.'
	},
	{
		label: 'anthropic · claude-sonnet-4-5-20250514',
		provider: 'anthropic',
		modelId: 'claude-sonnet-4-5-20250514',
		costTier: 'high',
		qualityTier: 'frontier',
		speed: 'thorough',
		contextWindow: '200k',
		bestFor: 'Dense PDFs, messy OCR, or when extraction errors are costly to fix later.'
	},
	{
		label: 'openai · gpt-4o-mini',
		provider: 'openai',
		modelId: 'gpt-4o-mini',
		costTier: 'low',
		qualityTier: 'capable',
		speed: 'fast',
		contextWindow: '128k',
		bestFor: 'Cheapest OpenAI path for straightforward web text and short pieces.'
	},
	{
		label: 'openai · gpt-4o',
		provider: 'openai',
		modelId: 'gpt-4o',
		costTier: 'medium',
		qualityTier: 'strong',
		speed: 'balanced',
		contextWindow: '128k',
		bestFor: 'General extraction when you want solid quality without flagship spend.'
	},
	{
		label: 'openai · gpt-5',
		provider: 'openai',
		modelId: 'gpt-5',
		costTier: 'high',
		qualityTier: 'frontier',
		speed: 'thorough',
		contextWindow: '200k',
		bestFor: 'Hardest documents or when you need maximum reasoning depth.'
	},
	{
		label: 'google · gemini-2.5-flash',
		provider: 'google',
		modelId: 'gemini-2.5-flash',
		costTier: 'low',
		qualityTier: 'capable',
		speed: 'fast',
		contextWindow: '1M',
		bestFor: 'Very long inputs (big Gutenberg chunks); fast and cheap; verify edge cases.'
	},
	{
		label: 'google · gemini-2.5-pro',
		provider: 'google',
		modelId: 'gemini-2.5-pro',
		costTier: 'medium',
		qualityTier: 'strong',
		speed: 'balanced',
		contextWindow: '1M',
		bestFor: 'Long context plus strong quality — strong for books and long-form HTML.'
	}
];

export type IngestionSourceTypeId =
	| 'sep_entry'
	| 'gutenberg_text'
	| 'journal_article'
	| 'web_article';

export interface SourceTypeModelHints {
	/** Cheapest reasonable default for this source profile */
	budget: string;
	/** Typical sweet spot */
	balanced: string;
	/** When quality matters more than cost */
	quality: string;
	note: string;
}

export const INGESTION_SOURCE_MODEL_HINTS: Record<IngestionSourceTypeId, SourceTypeModelHints> = {
	sep_entry: {
		budget: 'anthropic · claude-3-5-haiku-20241022',
		balanced: 'anthropic · claude-3-5-sonnet-20241022',
		quality: 'anthropic · claude-sonnet-4-5-20250514',
		note: 'SEP HTML is usually clean: Sonnet-class is often enough; step up for difficult entries.'
	},
	gutenberg_text: {
		budget: 'google · gemini-2.5-flash',
		balanced: 'google · gemini-2.5-pro',
		quality: 'anthropic · claude-sonnet-4-5-20250514',
		note: 'Very long inputs favour Gemini’s window; use smaller chunks if you stay on smaller-context models.'
	},
	journal_article: {
		budget: 'openai · gpt-4o',
		balanced: 'anthropic · claude-3-5-sonnet-20241022',
		quality: 'openai · gpt-5',
		note: 'PDFs and citations are error-prone: prefer frontier-tier for first-pass extraction when budget allows.'
	},
	web_article: {
		budget: 'openai · gpt-4o-mini',
		balanced: 'openai · gpt-4o',
		quality: 'anthropic · claude-sonnet-4-5-20250514',
		note: 'Noisy HTML/CSS varies wildly; cheaper models can work for simple blog text.'
	}
};

export function catalogEntryForLabel(label: string): IngestionModelCatalogEntry | undefined {
	const t = label.trim();
	return INGESTION_MODEL_CATALOG.find((e) => e.label === t);
}
