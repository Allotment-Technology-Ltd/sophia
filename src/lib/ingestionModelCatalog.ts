/**
 * Reference catalog for ingestion operators. Labels must match chain selects (`provider · modelId`).
 * Tiers are relative (market moves); use for comparison, not billing.
 * Keep in sync with Restormel / BYOK provider ids where possible.
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

/** [provider, modelId, cost, quality, speed, context, bestFor] */
type CatalogRow = [
	string,
	string,
	IngestionCostTier,
	IngestionQualityTier,
	IngestionSpeedTier,
	string,
	string
];

const INGESTION_MODEL_CATALOG_ROWS: CatalogRow[] = [
	// ─── Anthropic ───────────────────────────────────────────────────────
	[
		'anthropic',
		'claude-haiku-4-5-20251001',
		'low',
		'capable',
		'fast',
		'200k',
		'Budget extraction and lighter passes; clean HTML; high volume (replaces retired 3.5 Haiku).'
	],
	[
		'anthropic',
		'claude-sonnet-4-20250514',
		'medium',
		'strong',
		'balanced',
		'200k',
		'Default balance for SEP-style and general web text (replaces retired 3.5 Sonnet).'
	],
	[
		'anthropic',
		'claude-sonnet-4-20250514',
		'high',
		'frontier',
		'thorough',
		'200k',
		'Claude Sonnet 4 — dense PDFs, messy HTML, high-stakes extraction.'
	],
	[
		'anthropic',
		'claude-sonnet-4-5-20250929',
		'high',
		'frontier',
		'thorough',
		'200k',
		'Latest Sonnet 4.5 builds for long reasoning chains.'
	],
	[
		'anthropic',
		'claude-opus-4-1-20250805',
		'high',
		'frontier',
		'thorough',
		'200k',
		'Maximum Anthropic quality when cost is secondary.'
	],
	[
		'anthropic',
		'claude-opus-4-20250514',
		'high',
		'frontier',
		'thorough',
		'200k',
		'Opus-class depth for adversarial or subtle argumentation.'
	],
	// ─── OpenAI ───────────────────────────────────────────────────────────
	[
		'openai',
		'gpt-4o-mini',
		'low',
		'capable',
		'fast',
		'128k',
		'Cheapest OpenAI path for short, clean sources.'
	],
	['openai', 'gpt-4o', 'medium', 'strong', 'balanced', '128k', 'General-purpose extraction and validation.'],
	[
		'openai',
		'gpt-4.1',
		'medium',
		'strong',
		'balanced',
		'1M',
		'Long-context OpenAI when you need huge windows.'
	],
	['openai', 'gpt-4.1-mini', 'low', 'capable', 'fast', '1M', 'Long input on a budget.'],
	['openai', 'gpt-4.1-nano', 'low', 'capable', 'fast', '1M', 'Ultra-cheap long-context sketches.'],
	['openai', 'o3-mini', 'medium', 'strong', 'balanced', '200k', 'Reasoning-focused mid-cost option.'],
	['openai', 'o3', 'high', 'frontier', 'thorough', '200k', 'Heavy reasoning for hard validation tasks.'],
	['openai', 'o4-mini', 'medium', 'strong', 'balanced', '200k', 'Reasoning mini for cost-aware checks.'],
	['openai', 'gpt-5', 'high', 'frontier', 'thorough', '200k', 'Flagship depth when available in your org.'],
	['openai', 'gpt-5-mini', 'medium', 'strong', 'balanced', '200k', 'Strong but lighter GPT-5-class option.'],
	['openai', 'gpt-5-nano', 'low', 'capable', 'fast', '200k', 'Fast GPT-5-class for bulk passes.'],
	// ─── Google (AI Studio style) ─────────────────────────────────────────
	[
		'google',
		'gemini-2.0-flash',
		'low',
		'capable',
		'fast',
		'1M',
		'Very fast Gemini for long chunks and screening.'
	],
	[
		'google',
		'gemini-2.0-flash-lite',
		'low',
		'capable',
		'fast',
		'1M',
		'Lowest-latency Gemini flash-lite.'
	],
	[
		'google',
		'gemini-2.5-flash',
		'low',
		'capable',
		'fast',
		'1M',
		'Long books and Gutenberg-scale text; verify edge cases.'
	],
	[
		'google',
		'gemini-2.5-flash-lite',
		'low',
		'capable',
		'fast',
		'1M',
		'Cheaper 2.5 Flash for massive inputs.'
	],
	[
		'google',
		'gemini-2.5-pro',
		'medium',
		'strong',
		'balanced',
		'1M',
		'Strong long-context quality for books and messy sites.'
	],
	[
		'google',
		'gemini-1.5-pro',
		'medium',
		'strong',
		'balanced',
		'1M',
		'Stable 1.5 Pro for legacy routes and comparisons.'
	],
	[
		'google',
		'gemini-1.5-flash',
		'low',
		'capable',
		'fast',
		'1M',
		'Legacy flash for high-volume or older Restormel steps.'
	],
	[
		'google',
		'text-embedding-005',
		'low',
		'capable',
		'fast',
		'2k',
		'Google embedding model (often via Vertex); retrieval / vector stages.'
	],
	[
		'google',
		'text-multilingual-embedding-002',
		'low',
		'capable',
		'fast',
		'2k',
		'Multilingual embeddings for mixed-language corpora.'
	],
	// ─── Vertex (GCP) — same Gemini ids many Restormel projects use ──────
	['vertex', 'gemini-2.0-flash', 'low', 'capable', 'fast', '1M', 'Vertex-hosted Gemini 2.0 Flash.'],
	['vertex', 'gemini-2.0-flash-lite', 'low', 'capable', 'fast', '1M', 'Vertex flash-lite.'],
	['vertex', 'gemini-2.5-flash', 'low', 'capable', 'fast', '1M', 'Vertex 2.5 Flash — common default.'],
	['vertex', 'gemini-2.5-flash-lite', 'low', 'capable', 'fast', '1M', 'Vertex 2.5 Flash Lite.'],
	['vertex', 'gemini-2.5-pro', 'medium', 'strong', 'balanced', '1M', 'Vertex 2.5 Pro for quality-first.'],
	['vertex', 'gemini-1.5-pro', 'medium', 'strong', 'balanced', '1M', 'Vertex 1.5 Pro.'],
	['vertex', 'gemini-1.5-flash', 'low', 'capable', 'fast', '1M', 'Vertex 1.5 Flash.'],
	[
		'vertex',
		'text-embedding-005',
		'low',
		'capable',
		'fast',
		'2k',
		'Vertex text-embedding-005 (768-dim class); Sophia ingest default embedding family.'
	],
	[
		'vertex',
		'text-multilingual-embedding-002',
		'low',
		'capable',
		'fast',
		'2k',
		'Vertex multilingual embedding (002 family); pairs with google · text-multilingual-embedding-002.'
	],
	['vertex', 'text-embedding-004', 'low', 'capable', 'fast', '2k', 'Legacy Vertex embedding id.'],
	[
		'vertex',
		'multimodalembedding@001',
		'low',
		'capable',
		'fast',
		'2k',
		'Multimodal embedding when Restormel routes need it.'
	],
	// ─── DeepSeek ────────────────────────────────────────────────────────
	[
		'deepseek',
		'deepseek-chat',
		'low',
		'strong',
		'balanced',
		'128k',
		'Excellent cost/quality for extraction and relation passes.'
	],
	[
		'deepseek',
		'deepseek-reasoner',
		'high',
		'frontier',
		'thorough',
		'128k',
		'Reasoning mode for hard validation and contested text.'
	],
	[
		'deepseek',
		'deepseek-coder',
		'medium',
		'strong',
		'balanced',
		'128k',
		'Code-leaning; useful for formal logic snippets in papers.'
	],
	// ─── Groq ────────────────────────────────────────────────────────────
	[
		'groq',
		'llama-3.3-70b-versatile',
		'low',
		'strong',
		'fast',
		'128k',
		'Very fast Llama 3.3 on Groq for high-throughput passes.'
	],
	[
		'groq',
		'deepseek-r1-distill-llama-70b',
		'low',
		'strong',
		'fast',
		'128k',
		'Distilled reasoning model; good for cheap “think” steps.'
	],
	['groq', 'mixtral-8x7b-32768', 'low', 'capable', 'fast', '32k', 'Legacy Mixtral on Groq.'],
	[
		'groq',
		'qwen-qwq-32b-preview',
		'low',
		'strong',
		'fast',
		'32k',
		'Qwen reasoning preview on Groq when enabled.'
	],
	[
		'groq',
		'gemma2-9b-it',
		'low',
		'capable',
		'fast',
		'8k',
		'Small Gemma instruct for ultra-cheap passes.'
	],
	// ─── Mistral ─────────────────────────────────────────────────────────
	[
		'mistral',
		'mistral-large-latest',
		'high',
		'frontier',
		'balanced',
		'128k',
		'Flagship Mistral for quality-sensitive extraction.'
	],
	[
		'mistral',
		'mistral-medium-latest',
		'medium',
		'strong',
		'balanced',
		'128k',
		'Balanced Mistral tier.'
	],
	[
		'mistral',
		'mistral-small-latest',
		'low',
		'capable',
		'fast',
		'32k',
		'Fast Mistral small for grouping / cleanup.'
	],
	['mistral', 'ministral-8b-latest', 'low', 'capable', 'fast', '128k', 'Tiny Ministral for edge cost.'],
	['mistral', 'codestral-latest', 'medium', 'strong', 'balanced', '256k', 'Code-heavy philosophical formalism.'],
	// ─── Together ────────────────────────────────────────────────────────
	[
		'together',
		'meta-llama/Llama-3.3-70B-Instruct-Turbo',
		'low',
		'strong',
		'fast',
		'128k',
		'Open Llama 3.3 70B hosted on Together.'
	],
	[
		'together',
		'Qwen/Qwen2.5-72B-Instruct-Turbo',
		'medium',
		'strong',
		'balanced',
		'128k',
		'Qwen 2.5 instruct for long-form non-English.'
	],
	[
		'together',
		'deepseek-ai/DeepSeek-R1',
		'medium',
		'frontier',
		'thorough',
		'128k',
		'DeepSeek R1 on Together for reasoning-heavy steps.'
	],
	[
		'together',
		'deepseek-ai/DeepSeek-V3',
		'low',
		'strong',
		'balanced',
		'128k',
		'DeepSeek V3 instruct on Together.'
	],
	[
		'together',
		'mistralai/Mixtral-8x22B-Instruct-v0.1',
		'medium',
		'strong',
		'balanced',
		'64k',
		'Large Mixtral MoE for breadth.'
	],
	// ─── OpenRouter (routed slugs) ───────────────────────────────────────
	[
		'openrouter',
		'anthropic/claude-sonnet-4',
		'high',
		'frontier',
		'thorough',
		'200k',
		'OpenRouter → Claude Sonnet 4 class.'
	],
	['openrouter', 'openai/gpt-4o', 'medium', 'strong', 'balanced', '128k', 'OpenRouter → GPT-4o.'],
	['openrouter', 'openai/gpt-4o-mini', 'low', 'capable', 'fast', '128k', 'OpenRouter → GPT-4o mini.'],
	['openrouter', 'openai/gpt-4.1', 'medium', 'strong', 'balanced', '1M', 'OpenRouter → GPT-4.1.'],
	[
		'openrouter',
		'google/gemini-2.5-pro',
		'medium',
		'strong',
		'balanced',
		'1M',
		'OpenRouter → Gemini 2.5 Pro.'
	],
	[
		'openrouter',
		'google/gemini-2.5-flash',
		'low',
		'capable',
		'fast',
		'1M',
		'OpenRouter → Gemini 2.5 Flash.'
	],
	[
		'openrouter',
		'deepseek/deepseek-chat',
		'low',
		'strong',
		'balanced',
		'128k',
		'OpenRouter → DeepSeek Chat.'
	],
	[
		'openrouter',
		'deepseek/deepseek-r1',
		'high',
		'frontier',
		'thorough',
		'128k',
		'OpenRouter → DeepSeek R1.'
	],
	[
		'openrouter',
		'meta-llama/llama-3.3-70b-instruct',
		'low',
		'strong',
		'fast',
		'128k',
		'OpenRouter → Llama 3.3 70B.'
	],
	[
		'openrouter',
		'qwen/qwen-2.5-72b-instruct',
		'medium',
		'strong',
		'balanced',
		'128k',
		'OpenRouter → Qwen 2.5 72B.'
	],
	// ─── Perplexity ──────────────────────────────────────────────────────
	[
		'perplexity',
		'sonar',
		'low',
		'capable',
		'fast',
		'127k',
		'Light Sonar for quick checks and shallow extraction.'
	],
	[
		'perplexity',
		'sonar-pro',
		'medium',
		'strong',
		'balanced',
		'127k',
		'Sonar Pro for stronger synthesis-style validation.'
	],
	[
		'perplexity',
		'sonar-reasoning',
		'high',
		'frontier',
		'thorough',
		'127k',
		'Reasoning Sonar for hard QA-style passes.'
	],
	[
		'perplexity',
		'sonar-reasoning-pro',
		'high',
		'frontier',
		'thorough',
		'127k',
		'Top Perplexity reasoning tier when available.'
	],
	// ─── Cohere ──────────────────────────────────────────────────────────
	[
		'cohere',
		'command-r-plus',
		'medium',
		'strong',
		'balanced',
		'128k',
		'Cohere Command R+ for long RAG-style extraction.'
	],
	['cohere', 'command-r', 'low', 'strong', 'fast', '128k', 'Command R for cheaper long context.'],
	['cohere', 'command-r7b-12-2024', 'low', 'capable', 'fast', '128k', 'Small Command R for edge cost.'],
	// ─── Voyage AI — embeddings & retrieval ─────────────────────────────
	[
		'voyage',
		'voyage-4',
		'medium',
		'strong',
		'balanced',
		'32k',
		'General-purpose Voyage 4 embeddings (MoE family).'
	],
	[
		'voyage',
		'voyage-4-lite',
		'low',
		'capable',
		'fast',
		'32k',
		'Fast / cheap Voyage 4 for high volume.'
	],
	[
		'voyage',
		'voyage-4-large',
		'high',
		'frontier',
		'thorough',
		'32k',
		'Highest-quality Voyage 4 when latency allows.'
	],
	[
		'voyage',
		'voyage-4-nano',
		'low',
		'capable',
		'fast',
		'32k',
		'Nano Voyage 4 for massive batch embedding.'
	],
	['voyage', 'voyage-3-large', 'medium', 'strong', 'balanced', '32k', 'Prior-gen large embedding.'],
	['voyage', 'voyage-3', 'medium', 'strong', 'balanced', '32k', 'Voyage 3 general embedding.'],
	['voyage', 'voyage-3-lite', 'low', 'capable', 'fast', '32k', 'Voyage 3 lite for cost.'],
	[
		'voyage',
		'voyage-code-3',
		'medium',
		'strong',
		'balanced',
		'32k',
		'Code-optimized embeddings (formal proofs, pseudocode).'
	],
	[
		'voyage',
		'voyage-finance-2',
		'medium',
		'strong',
		'balanced',
		'32k',
		'Finance-domain embedding for econ / policy text.'
	],
	[
		'voyage',
		'voyage-law-2',
		'medium',
		'strong',
		'balanced',
		'16k',
		'Legal-domain embedding for jurisprudence sources.'
	],
	[
		'voyage',
		'voyage-context-3',
		'medium',
		'strong',
		'balanced',
		'32k',
		'Chunk- and document-level retrieval embedding.'
	],
	[
		'voyage',
		'voyage-multilingual-2',
		'medium',
		'strong',
		'balanced',
		'32k',
		'Multilingual embedding for non-English corpora.'
	],
	['voyage', 'voyage-2', 'low', 'capable', 'fast', '4k', 'Legacy Voyage 2 (smaller context).']
];

export const INGESTION_MODEL_CATALOG: IngestionModelCatalogEntry[] = INGESTION_MODEL_CATALOG_ROWS.map(
	([provider, modelId, costTier, qualityTier, speed, contextWindow, bestFor]) => ({
		label: `${provider} · ${modelId}`,
		provider,
		modelId,
		costTier,
		qualityTier,
		speed,
		contextWindow,
		bestFor
	})
);

export type IngestionSourceTypeId =
	| 'sep_entry'
	| 'iep_entry'
	| 'gutenberg_text'
	| 'journal_article'
	| 'philpapers_paper'
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
		budget: 'anthropic · claude-haiku-4-5-20251001',
		balanced: 'anthropic · claude-sonnet-4-20250514',
		quality: 'anthropic · claude-sonnet-4-5-20250929',
		note: 'SEP HTML is usually clean: Sonnet-class is often enough; step up for difficult entries.'
	},
	iep_entry: {
		budget: 'anthropic · claude-haiku-4-5-20251001',
		balanced: 'anthropic · claude-sonnet-4-20250514',
		quality: 'anthropic · claude-sonnet-4-5-20250929',
		note: 'IEP mirrors SEP-style structure; watch for noisier markup than SEP.'
	},
	gutenberg_text: {
		budget: 'google · gemini-2.5-flash',
		balanced: 'google · gemini-2.5-pro',
		quality: 'anthropic · claude-sonnet-4-5-20250929',
		note: 'Very long inputs favour Gemini’s window; use smaller chunks if you stay on smaller-context models.'
	},
	journal_article: {
		budget: 'deepseek · deepseek-chat',
		balanced: 'openai · gpt-4o',
		quality: 'deepseek · deepseek-reasoner',
		note: 'Journal PDFs and heavy citations: frontier validation when budget allows.'
	},
	philpapers_paper: {
		budget: 'openai · gpt-4o-mini',
		balanced: 'openai · gpt-4o',
		quality: 'anthropic · claude-sonnet-4-5-20250929',
		note: 'PhilPapers-style listings (PDF/HTML): metadata noise; step up for dense analytic papers.'
	},
	web_article: {
		budget: 'openai · gpt-4o-mini',
		balanced: 'deepseek · deepseek-chat',
		quality: 'deepseek · deepseek-reasoner',
		note: 'DeepSeek is strong value for noisy HTML; use Voyage embeddings in Restormel when retrieval quality matters.'
	}
};

export function catalogEntryForLabel(label: string): IngestionModelCatalogEntry | undefined {
	const t = label.trim();
	return INGESTION_MODEL_CATALOG.find((e) => e.label === t);
}
