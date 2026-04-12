import { fileURLToPath } from 'node:url';
import { Surreal } from 'surrealdb';
import { getEmbeddingDimensions } from '../src/lib/server/embeddings';
import {
	defineClaimEmbeddingIndex,
	requireVectorIndex
} from './lib/surrealClaimVectorIndex.js';

// Read environment variables
const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';
const CLAIM_EMBEDDING_DIMENSION = getEmbeddingDimensions();

async function signInWithScopeFallback(db: Surreal): Promise<void> {
	try {
		await db.signin({
			namespace: SURREAL_NAMESPACE,
			database: SURREAL_DATABASE,
			username: SURREAL_USER,
			password: SURREAL_PASS
		} as any);
	} catch (scopedError) {
		try {
			await db.signin({
				username: SURREAL_USER,
				password: SURREAL_PASS
			} as any);
		} catch {
			throw scopedError;
		}
	}
}

export async function setupSchema(existingDb?: Surreal) {
	const db = existingDb ?? new Surreal();
	const ownsConnection = !existingDb;

	try {
		if (ownsConnection) {
			console.log('[SETUP] Connecting to SurrealDB...');
			await db.connect(SURREAL_URL);
			console.log(`[SETUP] Connected to ${SURREAL_URL}`);

			// Sign in
			await signInWithScopeFallback(db);
			console.log('[SETUP] Authenticated successfully');

			// Select namespace and database
			await db.use({
				namespace: SURREAL_NAMESPACE,
				database: SURREAL_DATABASE
			});
			console.log(`[SETUP] Using namespace: ${SURREAL_NAMESPACE}, database: ${SURREAL_DATABASE}`);
		}

		// Define tables
		console.log('[SETUP] Creating schema...');

		// 1. SOURCE TABLE
		await db.query(`
			DEFINE TABLE IF NOT EXISTS source SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS title ON source TYPE string;
			DEFINE FIELD IF NOT EXISTS author ON source TYPE array<string>;
			DEFINE FIELD IF NOT EXISTS year ON source TYPE option<int>;
			DEFINE FIELD IF NOT EXISTS source_type ON source TYPE string
				ASSERT $value IN ['book', 'paper', 'sep_entry', 'iep_entry', 'article', 'institutional'];
			DEFINE FIELD IF NOT EXISTS url ON source TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS canonical_url ON source TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS canonical_url_hash ON source TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS visibility_scope ON source TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS deletion_state ON source TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS ingested_at ON source TYPE datetime VALUE time::now();
			DEFINE FIELD IF NOT EXISTS claim_count ON source TYPE option<int>;
			DEFINE FIELD IF NOT EXISTS status ON source TYPE string
				DEFAULT 'pending'
				ASSERT $value IN ['pending', 'ingested', 'validated', 'quarantined'];
			DEFINE FIELD IF NOT EXISTS exclude_from_model_training ON source TYPE bool DEFAULT false;
		`);
		console.log('[SETUP] ✓ Table: source');

		await db.query(`
			DEFINE INDEX IF NOT EXISTS source_url ON source FIELDS url;
			DEFINE INDEX IF NOT EXISTS source_canonical_url_hash ON source FIELDS canonical_url_hash;
		`);
		console.log('[SETUP] ✓ Indexes: source (url, canonical_url_hash)');

			// 2. PASSAGE TABLE
			await db.query(`
				DEFINE TABLE IF NOT EXISTS passage SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS source ON passage TYPE record<source>;
				DEFINE FIELD IF NOT EXISTS text ON passage TYPE string;
				DEFINE FIELD IF NOT EXISTS summary ON passage TYPE string;
				DEFINE FIELD IF NOT EXISTS section_title ON passage TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS order_in_source ON passage TYPE int;
				DEFINE FIELD IF NOT EXISTS span_start ON passage TYPE int;
				DEFINE FIELD IF NOT EXISTS span_end ON passage TYPE int;
				DEFINE FIELD IF NOT EXISTS role ON passage TYPE string
					ASSERT $value IN ['thesis', 'premise', 'objection', 'reply', 'definition', 'distinction', 'example', 'interpretive_commentary'];
				DEFINE FIELD IF NOT EXISTS role_confidence ON passage TYPE float DEFAULT 0.55;
				DEFINE FIELD IF NOT EXISTS review_state ON passage TYPE string
					DEFAULT 'candidate'
					ASSERT $value IN ['candidate', 'accepted', 'rejected', 'merged', 'needs_review'];
				DEFINE FIELD IF NOT EXISTS verification_state ON passage TYPE string
					DEFAULT 'unverified'
					ASSERT $value IN ['unverified', 'validated', 'flagged'];
				DEFINE FIELD IF NOT EXISTS extractor_version ON passage TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS review_notes ON passage TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_by ON passage TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_at ON passage TYPE option<datetime>;
			`);
			console.log('[SETUP] ✓ Table: passage');

			await db.query(`
				DEFINE INDEX IF NOT EXISTS passage_source ON passage FIELDS source;
				DEFINE INDEX IF NOT EXISTS passage_order ON passage FIELDS source, order_in_source UNIQUE;
			`);
			console.log('[SETUP] ✓ Indexes: passage (source, source+order)');

			// 3. CLAIM TABLE
			await db.query(`
				DEFINE TABLE IF NOT EXISTS claim SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS text ON claim TYPE string;
			DEFINE FIELD IF NOT EXISTS claim_type ON claim TYPE string
				ASSERT $value IN ['thesis', 'premise', 'objection', 'response', 'definition', 'thought_experiment', 'empirical', 'methodological'];
				DEFINE FIELD IF NOT EXISTS domain ON claim TYPE string
					ASSERT $value IN ['epistemology', 'metaphysics', 'ethics', 'philosophy_of_mind', 'political_philosophy', 'logic', 'aesthetics', 'philosophy_of_science', 'philosophy_of_language', 'applied_ethics', 'philosophy_of_ai'];
				DEFINE FIELD IF NOT EXISTS source ON claim TYPE record<source>;
				DEFINE FIELD IF NOT EXISTS passage ON claim TYPE option<record<passage>>;
				DEFINE FIELD IF NOT EXISTS passage_order ON claim TYPE option<int>;
				DEFINE FIELD IF NOT EXISTS passage_role ON claim TYPE option<string>
					ASSERT $value = NONE OR $value IN ['thesis', 'premise', 'objection', 'reply', 'definition', 'distinction', 'example', 'interpretive_commentary'];
				DEFINE FIELD IF NOT EXISTS section_context ON claim TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS position_in_source ON claim TYPE option<int>;
				DEFINE FIELD IF NOT EXISTS source_span_start ON claim TYPE option<int>;
				DEFINE FIELD IF NOT EXISTS source_span_end ON claim TYPE option<int>;
				DEFINE FIELD IF NOT EXISTS confidence ON claim TYPE float DEFAULT 0.8;
				DEFINE FIELD IF NOT EXISTS embedding ON claim TYPE option<array<float>>;
				DEFINE FIELD IF NOT EXISTS validation_score ON claim TYPE option<float>;
				DEFINE FIELD IF NOT EXISTS claim_origin ON claim TYPE string
					DEFAULT 'source_grounded'
					ASSERT $value IN ['source_grounded', 'interpretive', 'synthetic', 'user_generated'];
				DEFINE FIELD IF NOT EXISTS subdomain ON claim TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS thinker ON claim TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS tradition ON claim TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS era ON claim TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS claim_scope ON claim TYPE string
					DEFAULT 'descriptive'
					ASSERT $value IN ['normative', 'descriptive', 'metaphilosophical', 'empirical'];
				DEFINE FIELD IF NOT EXISTS attributed_to ON claim TYPE option<array<string>>;
				DEFINE FIELD IF NOT EXISTS concept_tags ON claim TYPE option<array<string>>;
				DEFINE FIELD IF NOT EXISTS review_state ON claim TYPE string
					DEFAULT 'candidate'
					ASSERT $value IN ['candidate', 'accepted', 'rejected', 'merged', 'needs_review'];
				DEFINE FIELD IF NOT EXISTS verification_state ON claim TYPE string
					DEFAULT 'unverified'
					ASSERT $value IN ['unverified', 'validated', 'flagged'];
				DEFINE FIELD IF NOT EXISTS extractor_version ON claim TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS contested_terms ON claim TYPE option<array<string>>;
				DEFINE FIELD IF NOT EXISTS review_notes ON claim TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_by ON claim TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_at ON claim TYPE option<datetime>;
				DEFINE FIELD IF NOT EXISTS merge_target ON claim TYPE option<record<claim>>;
				DEFINE FIELD IF NOT EXISTS merge_classification ON claim TYPE option<string>
					ASSERT $value = NONE OR $value IN ['exact_duplicate', 'paraphrase_duplicate', 'broader_narrower', 'related_not_duplicate'];
			`);
			console.log('[SETUP] ✓ Table: claim');

		// Create indexes for claim table.
		// Vector index: HNSW (preferred) or MTREE fallback — see scripts/lib/surrealClaimVectorIndex.ts
		await db.query(`
			DEFINE INDEX IF NOT EXISTS claim_domain ON claim FIELDS domain;
			DEFINE INDEX IF NOT EXISTS claim_source ON claim FIELDS source;
			DEFINE INDEX IF NOT EXISTS claim_passage ON claim FIELDS passage;
			DEFINE INDEX IF NOT EXISTS claim_source_position ON claim FIELDS source, position_in_source;
		`);
		try {
			const vec = await defineClaimEmbeddingIndex(db, { dimension: CLAIM_EMBEDDING_DIMENSION });
			console.log(
				`[SETUP] ✓ Indexes: claim (embedding:${CLAIM_EMBEDDING_DIMENSION}d ${vec.kind.toUpperCase()}, domain, source, passage, source+position)`
			);
		} catch (embeddingIndexError) {
			if (requireVectorIndex()) {
				throw embeddingIndexError;
			}
			console.warn(
				'[SETUP] ⚠ Skipping claim_embedding vector index (set SURREAL_REQUIRE_VECTOR_INDEX=1 to fail hard).',
				embeddingIndexError instanceof Error ? embeddingIndexError.message : String(embeddingIndexError)
			);
			console.log('[SETUP] ✓ Indexes: claim (domain, source, passage, source+position)');
		}

			// 4. ARGUMENT TABLE
		await db.query(`
			DEFINE TABLE IF NOT EXISTS argument SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS name ON argument TYPE string;
			DEFINE FIELD IF NOT EXISTS summary ON argument TYPE string;
			DEFINE FIELD IF NOT EXISTS tradition ON argument TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS domain ON argument TYPE string
				ASSERT $value IN ['epistemology', 'metaphysics', 'ethics', 'philosophy_of_mind', 'political_philosophy', 'logic', 'aesthetics', 'philosophy_of_science', 'philosophy_of_language', 'applied_ethics', 'philosophy_of_ai'];
			DEFINE FIELD IF NOT EXISTS source ON argument TYPE record<source>;
		`);
		console.log('[SETUP] ✓ Table: argument');

			// 5. RELATION: SUPPORTS
			await db.query(`
				DEFINE TABLE IF NOT EXISTS supports TYPE RELATION IN claim OUT claim SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS strength ON supports TYPE string
					ASSERT $value IN ['strong', 'moderate', 'weak'];
				DEFINE FIELD IF NOT EXISTS note ON supports TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS evidence_passages ON supports TYPE option<array<record<passage>>>;
				DEFINE FIELD IF NOT EXISTS relation_confidence ON supports TYPE option<float>;
				DEFINE FIELD IF NOT EXISTS relation_inference_mode ON supports TYPE option<string>
					ASSERT $value = NONE OR $value IN ['explicit', 'inferred'];
				DEFINE FIELD IF NOT EXISTS review_state ON supports TYPE option<string>
					ASSERT $value = NONE OR $value IN ['candidate', 'accepted', 'rejected', 'merged', 'needs_review'];
				DEFINE FIELD IF NOT EXISTS verification_state ON supports TYPE option<string>
					ASSERT $value = NONE OR $value IN ['unverified', 'validated', 'flagged'];
				DEFINE FIELD IF NOT EXISTS extractor_version ON supports TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS review_notes ON supports TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_by ON supports TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_at ON supports TYPE option<datetime>;
			`);
			console.log('[SETUP] ✓ Relation: supports');

			// 6. RELATION: CONTRADICTS
			await db.query(`
				DEFINE TABLE IF NOT EXISTS contradicts TYPE RELATION IN claim OUT claim SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS strength ON contradicts TYPE string
					ASSERT $value IN ['strong', 'moderate', 'weak'];
				DEFINE FIELD IF NOT EXISTS note ON contradicts TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS evidence_passages ON contradicts TYPE option<array<record<passage>>>;
				DEFINE FIELD IF NOT EXISTS relation_confidence ON contradicts TYPE option<float>;
				DEFINE FIELD IF NOT EXISTS relation_inference_mode ON contradicts TYPE option<string>
					ASSERT $value = NONE OR $value IN ['explicit', 'inferred'];
				DEFINE FIELD IF NOT EXISTS review_state ON contradicts TYPE option<string>
					ASSERT $value = NONE OR $value IN ['candidate', 'accepted', 'rejected', 'merged', 'needs_review'];
				DEFINE FIELD IF NOT EXISTS verification_state ON contradicts TYPE option<string>
					ASSERT $value = NONE OR $value IN ['unverified', 'validated', 'flagged'];
				DEFINE FIELD IF NOT EXISTS extractor_version ON contradicts TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS review_notes ON contradicts TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_by ON contradicts TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_at ON contradicts TYPE option<datetime>;
			`);
			console.log('[SETUP] ✓ Relation: contradicts');

			// 7. RELATION: DEPENDS_ON
			await db.query(`
				DEFINE TABLE IF NOT EXISTS depends_on TYPE RELATION IN claim OUT claim SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS necessity ON depends_on TYPE string
					ASSERT $value IN ['essential', 'supporting', 'contextual'];
				DEFINE FIELD IF NOT EXISTS evidence_passages ON depends_on TYPE option<array<record<passage>>>;
				DEFINE FIELD IF NOT EXISTS relation_confidence ON depends_on TYPE option<float>;
				DEFINE FIELD IF NOT EXISTS relation_inference_mode ON depends_on TYPE option<string>
					ASSERT $value = NONE OR $value IN ['explicit', 'inferred'];
				DEFINE FIELD IF NOT EXISTS review_state ON depends_on TYPE option<string>
					ASSERT $value = NONE OR $value IN ['candidate', 'accepted', 'rejected', 'merged', 'needs_review'];
				DEFINE FIELD IF NOT EXISTS verification_state ON depends_on TYPE option<string>
					ASSERT $value = NONE OR $value IN ['unverified', 'validated', 'flagged'];
				DEFINE FIELD IF NOT EXISTS extractor_version ON depends_on TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS review_notes ON depends_on TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_by ON depends_on TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_at ON depends_on TYPE option<datetime>;
			`);
			console.log('[SETUP] ✓ Relation: depends_on');

			// 8. RELATION: RESPONDS_TO
			await db.query(`
				DEFINE TABLE IF NOT EXISTS responds_to TYPE RELATION IN claim OUT claim SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS response_type ON responds_to TYPE string
					ASSERT $value IN ['direct_rebuttal', 'undermining', 'concession', 'refinement'];
				DEFINE FIELD IF NOT EXISTS evidence_passages ON responds_to TYPE option<array<record<passage>>>;
				DEFINE FIELD IF NOT EXISTS relation_confidence ON responds_to TYPE option<float>;
				DEFINE FIELD IF NOT EXISTS relation_inference_mode ON responds_to TYPE option<string>
					ASSERT $value = NONE OR $value IN ['explicit', 'inferred'];
				DEFINE FIELD IF NOT EXISTS review_state ON responds_to TYPE option<string>
					ASSERT $value = NONE OR $value IN ['candidate', 'accepted', 'rejected', 'merged', 'needs_review'];
				DEFINE FIELD IF NOT EXISTS verification_state ON responds_to TYPE option<string>
					ASSERT $value = NONE OR $value IN ['unverified', 'validated', 'flagged'];
				DEFINE FIELD IF NOT EXISTS extractor_version ON responds_to TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS review_notes ON responds_to TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_by ON responds_to TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_at ON responds_to TYPE option<datetime>;
			`);
			console.log('[SETUP] ✓ Relation: responds_to');

			// 9. RELATION: DEFINES
			await db.query(`
				DEFINE TABLE IF NOT EXISTS defines TYPE RELATION IN claim OUT claim SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS note ON defines TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS evidence_passages ON defines TYPE option<array<record<passage>>>;
				DEFINE FIELD IF NOT EXISTS relation_confidence ON defines TYPE option<float>;
				DEFINE FIELD IF NOT EXISTS relation_inference_mode ON defines TYPE option<string>
					ASSERT $value = NONE OR $value IN ['explicit', 'inferred'];
				DEFINE FIELD IF NOT EXISTS review_state ON defines TYPE option<string>
					ASSERT $value = NONE OR $value IN ['candidate', 'accepted', 'rejected', 'merged', 'needs_review'];
				DEFINE FIELD IF NOT EXISTS verification_state ON defines TYPE option<string>
					ASSERT $value = NONE OR $value IN ['unverified', 'validated', 'flagged'];
				DEFINE FIELD IF NOT EXISTS extractor_version ON defines TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS review_notes ON defines TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_by ON defines TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_at ON defines TYPE option<datetime>;
			`);
			console.log('[SETUP] ✓ Relation: defines');

			// 10. RELATION: QUALIFIES
			await db.query(`
				DEFINE TABLE IF NOT EXISTS qualifies TYPE RELATION IN claim OUT claim SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS qualification_type ON qualifies TYPE string
					ASSERT $value IN ['restrictive', 'conditional', 'clarifying'];
				DEFINE FIELD IF NOT EXISTS note ON qualifies TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS evidence_passages ON qualifies TYPE option<array<record<passage>>>;
				DEFINE FIELD IF NOT EXISTS relation_confidence ON qualifies TYPE option<float>;
				DEFINE FIELD IF NOT EXISTS relation_inference_mode ON qualifies TYPE option<string>
					ASSERT $value = NONE OR $value IN ['explicit', 'inferred'];
				DEFINE FIELD IF NOT EXISTS review_state ON qualifies TYPE option<string>
					ASSERT $value = NONE OR $value IN ['candidate', 'accepted', 'rejected', 'merged', 'needs_review'];
				DEFINE FIELD IF NOT EXISTS verification_state ON qualifies TYPE option<string>
					ASSERT $value = NONE OR $value IN ['unverified', 'validated', 'flagged'];
				DEFINE FIELD IF NOT EXISTS extractor_version ON qualifies TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS review_notes ON qualifies TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_by ON qualifies TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_at ON qualifies TYPE option<datetime>;
			`);
			console.log('[SETUP] ✓ Relation: qualifies');

			// 10b. LEGACY RELATIONS (READ-COMPATIBILITY ONLY)
			await db.query(`
				DEFINE TABLE IF NOT EXISTS refines TYPE RELATION IN claim OUT claim SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS refinement_type ON refines TYPE string
					ASSERT $value IN ['strengthens', 'qualifies', 'extends', 'clarifies'];
				DEFINE FIELD IF NOT EXISTS evidence_passages ON refines TYPE option<array<record<passage>>>;
				DEFINE FIELD IF NOT EXISTS relation_confidence ON refines TYPE option<float>;
				DEFINE FIELD IF NOT EXISTS relation_inference_mode ON refines TYPE option<string>
					ASSERT $value = NONE OR $value IN ['explicit', 'inferred'];
				DEFINE FIELD IF NOT EXISTS review_state ON refines TYPE option<string>
					ASSERT $value = NONE OR $value IN ['candidate', 'accepted', 'rejected', 'merged', 'needs_review'];
				DEFINE FIELD IF NOT EXISTS verification_state ON refines TYPE option<string>
					ASSERT $value = NONE OR $value IN ['unverified', 'validated', 'flagged'];
				DEFINE FIELD IF NOT EXISTS extractor_version ON refines TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS review_notes ON refines TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_by ON refines TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_at ON refines TYPE option<datetime>;

				DEFINE TABLE IF NOT EXISTS exemplifies TYPE RELATION IN claim OUT claim SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS evidence_passages ON exemplifies TYPE option<array<record<passage>>>;
				DEFINE FIELD IF NOT EXISTS relation_confidence ON exemplifies TYPE option<float>;
				DEFINE FIELD IF NOT EXISTS relation_inference_mode ON exemplifies TYPE option<string>
					ASSERT $value = NONE OR $value IN ['explicit', 'inferred'];
				DEFINE FIELD IF NOT EXISTS review_state ON exemplifies TYPE option<string>
					ASSERT $value = NONE OR $value IN ['candidate', 'accepted', 'rejected', 'merged', 'needs_review'];
				DEFINE FIELD IF NOT EXISTS verification_state ON exemplifies TYPE option<string>
					ASSERT $value = NONE OR $value IN ['unverified', 'validated', 'flagged'];
				DEFINE FIELD IF NOT EXISTS extractor_version ON exemplifies TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS review_notes ON exemplifies TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_by ON exemplifies TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS reviewed_at ON exemplifies TYPE option<datetime>;
			`);
			console.log('[SETUP] ✓ Legacy relations: refines, exemplifies');

			// 11. RELATION: PART_OF
		await db.query(`
			DEFINE TABLE IF NOT EXISTS part_of TYPE RELATION IN claim OUT argument SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS role ON part_of TYPE string
				ASSERT $value IN ['conclusion', 'key_premise', 'supporting_premise', 'assumption', 'objection', 'response'];
			DEFINE FIELD IF NOT EXISTS position ON part_of TYPE option<int>;
		`);
		console.log('[SETUP] ✓ Relation: part_of');

			// 12. REVIEW_AUDIT_LOG TABLE
		await db.query(`
			DEFINE TABLE IF NOT EXISTS review_audit_log SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS entity_kind ON review_audit_log TYPE string
				ASSERT $value IN ['claim', 'relation', 'claim_pair'];
			DEFINE FIELD IF NOT EXISTS entity_id ON review_audit_log TYPE string;
			DEFINE FIELD IF NOT EXISTS entity_table ON review_audit_log TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS action ON review_audit_log TYPE string
				ASSERT $value IN ['accept', 'reject', 'return_to_review', 'merge', 'classify_pair'];
			DEFINE FIELD IF NOT EXISTS previous_state ON review_audit_log TYPE option<string>
				ASSERT $value = NONE OR $value IN ['candidate', 'accepted', 'rejected', 'merged', 'needs_review'];
			DEFINE FIELD IF NOT EXISTS next_state ON review_audit_log TYPE option<string>
				ASSERT $value = NONE OR $value IN ['candidate', 'accepted', 'rejected', 'merged', 'needs_review'];
			DEFINE FIELD IF NOT EXISTS reviewer_uid ON review_audit_log TYPE string;
			DEFINE FIELD IF NOT EXISTS reviewer_email ON review_audit_log TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS source_id ON review_audit_log TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS source_title ON review_audit_log TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS merge_target_id ON review_audit_log TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS merge_classification ON review_audit_log TYPE option<string>
				ASSERT $value = NONE OR $value IN ['exact_duplicate', 'paraphrase_duplicate', 'broader_narrower', 'related_not_duplicate'];
			DEFINE FIELD IF NOT EXISTS notes ON review_audit_log TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS metadata ON review_audit_log TYPE option<object>;
			DEFINE FIELD IF NOT EXISTS created_at ON review_audit_log TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Table: review_audit_log');

		await db.query(`
			DEFINE INDEX IF NOT EXISTS review_audit_entity ON review_audit_log FIELDS entity_kind, entity_id;
			DEFINE INDEX IF NOT EXISTS review_audit_created_at ON review_audit_log FIELDS created_at;
		`);
		console.log('[SETUP] ✓ Indexes: review_audit_log (entity, created_at)');

			// 13. QUERY_CACHE TABLE (with 7-day TTL for automatic expiration)
		await db.query(`
			DEFINE TABLE IF NOT EXISTS query_cache SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS query_hash ON query_cache TYPE string;
			DEFINE FIELD IF NOT EXISTS query_text ON query_cache TYPE string;
			DEFINE FIELD IF NOT EXISTS lens ON query_cache TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS events ON query_cache TYPE array<object>;
			DEFINE FIELD IF NOT EXISTS hit_count ON query_cache TYPE int DEFAULT 0;
			DEFINE FIELD IF NOT EXISTS created_at ON query_cache TYPE datetime VALUE time::now();
			DEFINE FIELD IF NOT EXISTS expires_at ON query_cache TYPE datetime VALUE (time::now() + 7d);
		`);
		console.log('[SETUP] ✓ Table: query_cache');

		// Create index for query_cache table
		await db.query(`
			DEFINE INDEX IF NOT EXISTS query_cache_hash ON query_cache FIELDS query_hash UNIQUE;
		`);
		console.log('[SETUP] ✓ Index: query_cache_hash');

			// 14. LINK_INGESTION_QUEUE TABLE (deferred nightly ingestion)
		await db.query(`
			DEFINE TABLE IF NOT EXISTS link_ingestion_queue SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS canonical_url ON link_ingestion_queue TYPE string;
			DEFINE FIELD IF NOT EXISTS canonical_url_hash ON link_ingestion_queue TYPE string;
			DEFINE FIELD IF NOT EXISTS hostname ON link_ingestion_queue TYPE string;
			DEFINE FIELD IF NOT EXISTS status ON link_ingestion_queue TYPE string
				DEFAULT 'queued'
				ASSERT $value IN ['queued', 'pending_review', 'approved', 'ingesting', 'ingested', 'failed', 'rejected'];
			DEFINE FIELD IF NOT EXISTS source_kinds ON link_ingestion_queue TYPE array<string>;
			DEFINE FIELD IF NOT EXISTS query_run_ids ON link_ingestion_queue TYPE array<string>;
			DEFINE FIELD IF NOT EXISTS latest_query_run_id ON link_ingestion_queue TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS submitted_by_uid ON link_ingestion_queue TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS submitted_by_uids ON link_ingestion_queue TYPE array<string>;
			DEFINE FIELD IF NOT EXISTS title_hint ON link_ingestion_queue TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS pass_hints ON link_ingestion_queue TYPE array<string>;
			DEFINE FIELD IF NOT EXISTS user_submission_count ON link_ingestion_queue TYPE int DEFAULT 0;
			DEFINE FIELD IF NOT EXISTS grounding_submission_count ON link_ingestion_queue TYPE int DEFAULT 0;
			DEFINE FIELD IF NOT EXISTS total_submission_count ON link_ingestion_queue TYPE int DEFAULT 0;
			DEFINE FIELD IF NOT EXISTS attempt_count ON link_ingestion_queue TYPE int DEFAULT 0;
			DEFINE FIELD IF NOT EXISTS last_error ON link_ingestion_queue TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS created_at ON link_ingestion_queue TYPE datetime VALUE time::now();
			DEFINE FIELD IF NOT EXISTS queued_at ON link_ingestion_queue TYPE datetime VALUE time::now();
			DEFINE FIELD IF NOT EXISTS approved_at ON link_ingestion_queue TYPE option<datetime>;
			DEFINE FIELD IF NOT EXISTS ingested_at ON link_ingestion_queue TYPE option<datetime>;
			DEFINE FIELD IF NOT EXISTS last_submitted_at ON link_ingestion_queue TYPE datetime VALUE time::now();
			DEFINE FIELD IF NOT EXISTS updated_at ON link_ingestion_queue TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Table: link_ingestion_queue');

		await db.query(`
			DEFINE INDEX IF NOT EXISTS link_ingestion_queue_canonical_hash
			ON link_ingestion_queue FIELDS canonical_url_hash UNIQUE;
			DEFINE INDEX IF NOT EXISTS link_ingestion_queue_status
			ON link_ingestion_queue FIELDS status;
			DEFINE INDEX IF NOT EXISTS link_ingestion_queue_last_submitted_at
			ON link_ingestion_queue FIELDS last_submitted_at;
		`);
		console.log('[SETUP] ✓ Indexes: link_ingestion_queue (canonical_hash, status, last_submitted_at)');

		// 15. THINKER GRAPH TABLES
		await db.query(`
			DEFINE TABLE IF NOT EXISTS thinker SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS wikidata_id ON thinker TYPE string;
			DEFINE FIELD IF NOT EXISTS name ON thinker TYPE string;
			DEFINE FIELD IF NOT EXISTS birth_year ON thinker TYPE option<int>;
			DEFINE FIELD IF NOT EXISTS death_year ON thinker TYPE option<int>;
			DEFINE FIELD IF NOT EXISTS traditions ON thinker TYPE array<string>;
			DEFINE FIELD IF NOT EXISTS domains ON thinker TYPE array<string>;
			DEFINE FIELD IF NOT EXISTS imported_at ON thinker TYPE datetime;
		`);
		console.log('[SETUP] ✓ Table: thinker');

		await db.query(`
			DEFINE INDEX IF NOT EXISTS thinker_wikidata_id ON thinker FIELDS wikidata_id UNIQUE;
			DEFINE INDEX IF NOT EXISTS thinker_name ON thinker FIELDS name;
		`);
		console.log('[SETUP] ✓ Indexes: thinker (wikidata_id, name)');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS influenced_by TYPE RELATION IN thinker OUT thinker SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS relation_subtype ON influenced_by TYPE string
				ASSERT $value IN ['influenced_by', 'inspired_by'];
			DEFINE FIELD IF NOT EXISTS imported_at ON influenced_by TYPE datetime;
		`);
		console.log('[SETUP] ✓ Relation: influenced_by');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS student_of TYPE RELATION IN thinker OUT thinker SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS relation_subtype ON student_of TYPE string
				ASSERT $value IN ['student_of'];
			DEFINE FIELD IF NOT EXISTS imported_at ON student_of TYPE datetime;
		`);
		console.log('[SETUP] ✓ Relation: student_of');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS authored TYPE RELATION IN thinker OUT source SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS match_type ON authored TYPE string;
			DEFINE FIELD IF NOT EXISTS confidence ON authored TYPE float;
			DEFINE FIELD IF NOT EXISTS linked_at ON authored TYPE datetime;
		`);
		console.log('[SETUP] ✓ Relation: authored');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS unresolved_thinker_reference SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS raw_name ON unresolved_thinker_reference TYPE string;
			DEFINE FIELD IF NOT EXISTS canonical_name ON unresolved_thinker_reference TYPE string;
			DEFINE FIELD IF NOT EXISTS source_ids ON unresolved_thinker_reference TYPE array<string>;
			DEFINE FIELD IF NOT EXISTS contexts ON unresolved_thinker_reference TYPE array<string>;
			DEFINE FIELD IF NOT EXISTS status ON unresolved_thinker_reference TYPE string
				DEFAULT 'queued'
				ASSERT $value IN ['queued', 'resolved', 'rejected'];
			DEFINE FIELD IF NOT EXISTS seen_count ON unresolved_thinker_reference TYPE int DEFAULT 1;
			DEFINE FIELD IF NOT EXISTS proposed_qids ON unresolved_thinker_reference TYPE array<string>;
			DEFINE FIELD IF NOT EXISTS proposed_labels ON unresolved_thinker_reference TYPE array<string>;
			DEFINE FIELD IF NOT EXISTS resolver_notes ON unresolved_thinker_reference TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS first_seen_at ON unresolved_thinker_reference TYPE datetime VALUE time::now();
			DEFINE FIELD IF NOT EXISTS last_seen_at ON unresolved_thinker_reference TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Table: unresolved_thinker_reference');

		await db.query(`
			DEFINE INDEX IF NOT EXISTS unresolved_thinker_reference_status
				ON unresolved_thinker_reference FIELDS status;
			DEFINE INDEX IF NOT EXISTS unresolved_thinker_reference_canonical_name
				ON unresolved_thinker_reference FIELDS canonical_name;
		`);
		console.log(
			'[SETUP] ✓ Indexes: unresolved_thinker_reference (status, canonical_name)'
		);

		await db.query(`
			DEFINE TABLE IF NOT EXISTS thinker_alias SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS canonical_name ON thinker_alias TYPE string;
			DEFINE FIELD IF NOT EXISTS raw_name ON thinker_alias TYPE string;
			DEFINE FIELD IF NOT EXISTS wikidata_id ON thinker_alias TYPE string;
			DEFINE FIELD IF NOT EXISTS label ON thinker_alias TYPE string;
			DEFINE FIELD IF NOT EXISTS confidence ON thinker_alias TYPE float;
			DEFINE FIELD IF NOT EXISTS resolved_by ON thinker_alias TYPE string
				ASSERT $value IN ['wikidata', 'manual', 'heuristic'];
			DEFINE FIELD IF NOT EXISTS status ON thinker_alias TYPE string
				DEFAULT 'active'
				ASSERT $value IN ['active', 'rejected'];
			DEFINE FIELD IF NOT EXISTS reviewer_uid ON thinker_alias TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS reviewer_email ON thinker_alias TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS source_contexts ON thinker_alias TYPE array<string>;
			DEFINE FIELD IF NOT EXISTS created_at ON thinker_alias TYPE datetime VALUE time::now();
			DEFINE FIELD IF NOT EXISTS updated_at ON thinker_alias TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Table: thinker_alias');

		await db.query(`
			DEFINE INDEX IF NOT EXISTS thinker_alias_canonical_name ON thinker_alias FIELDS canonical_name UNIQUE;
			DEFINE INDEX IF NOT EXISTS thinker_alias_wikidata_id ON thinker_alias FIELDS wikidata_id;
			DEFINE INDEX IF NOT EXISTS thinker_alias_status ON thinker_alias FIELDS status;
		`);
		console.log('[SETUP] ✓ Indexes: thinker_alias (canonical_name, wikidata_id, status)');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS thinker_resolution_audit_log SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS raw_name ON thinker_resolution_audit_log TYPE string;
			DEFINE FIELD IF NOT EXISTS canonical_name ON thinker_resolution_audit_log TYPE string;
			DEFINE FIELD IF NOT EXISTS wikidata_id ON thinker_resolution_audit_log TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS label ON thinker_resolution_audit_log TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS action ON thinker_resolution_audit_log TYPE string
				ASSERT $value IN [
					'auto_resolve',
					'manual_resolve',
					'manual_reject',
					'auto_queue',
					'auto_skip_ambiguous',
					'reconcile_resolve',
					'reconcile_queue'
				];
			DEFINE FIELD IF NOT EXISTS confidence ON thinker_resolution_audit_log TYPE option<float>;
			DEFINE FIELD IF NOT EXISTS source_id ON thinker_resolution_audit_log TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS queue_record_id ON thinker_resolution_audit_log TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS notes ON thinker_resolution_audit_log TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS metadata ON thinker_resolution_audit_log TYPE option<object>;
			DEFINE FIELD IF NOT EXISTS created_at ON thinker_resolution_audit_log TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Table: thinker_resolution_audit_log');

		await db.query(`
			DEFINE INDEX IF NOT EXISTS thinker_resolution_audit_canonical ON thinker_resolution_audit_log FIELDS canonical_name;
			DEFINE INDEX IF NOT EXISTS thinker_resolution_audit_created_at ON thinker_resolution_audit_log FIELDS created_at;
		`);
		console.log('[SETUP] ✓ Indexes: thinker_resolution_audit_log (canonical_name, created_at)');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS tradition SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS name ON tradition TYPE string;
			DEFINE FIELD IF NOT EXISTS slug ON tradition TYPE string;
			DEFINE FIELD IF NOT EXISTS imported_at ON tradition TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Table: tradition');
		await db.query(`
			DEFINE INDEX IF NOT EXISTS tradition_slug ON tradition FIELDS slug UNIQUE;
			DEFINE INDEX IF NOT EXISTS tradition_name ON tradition FIELDS name;
		`);
		console.log('[SETUP] ✓ Indexes: tradition (slug, name)');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS subject SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS name ON subject TYPE string;
			DEFINE FIELD IF NOT EXISTS slug ON subject TYPE string;
			DEFINE FIELD IF NOT EXISTS imported_at ON subject TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Table: subject');
		await db.query(`
			DEFINE INDEX IF NOT EXISTS subject_slug ON subject FIELDS slug UNIQUE;
			DEFINE INDEX IF NOT EXISTS subject_name ON subject FIELDS name;
		`);
		console.log('[SETUP] ✓ Indexes: subject (slug, name)');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS period SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS name ON period TYPE string;
			DEFINE FIELD IF NOT EXISTS slug ON period TYPE string;
			DEFINE FIELD IF NOT EXISTS year_start ON period TYPE option<int>;
			DEFINE FIELD IF NOT EXISTS year_end ON period TYPE option<int>;
			DEFINE FIELD IF NOT EXISTS imported_at ON period TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Table: period');
		await db.query(`
			DEFINE INDEX IF NOT EXISTS period_slug ON period FIELDS slug UNIQUE;
			DEFINE INDEX IF NOT EXISTS period_name ON period FIELDS name;
		`);
		console.log('[SETUP] ✓ Indexes: period (slug, name)');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS work SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS title ON work TYPE string;
			DEFINE FIELD IF NOT EXISTS source_id ON work TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS source_url ON work TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS imported_at ON work TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Table: work');
		await db.query(`
			DEFINE INDEX IF NOT EXISTS work_source_id ON work FIELDS source_id UNIQUE;
			DEFINE INDEX IF NOT EXISTS work_title ON work FIELDS title;
		`);
		console.log('[SETUP] ✓ Indexes: work (source_id, title)');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS belongs_to_tradition TYPE RELATION IN thinker OUT tradition SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS confidence ON belongs_to_tradition TYPE option<float>;
			DEFINE FIELD IF NOT EXISTS imported_at ON belongs_to_tradition TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Relation: belongs_to_tradition');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS works_in_domain TYPE RELATION IN thinker OUT subject SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS confidence ON works_in_domain TYPE option<float>;
			DEFINE FIELD IF NOT EXISTS imported_at ON works_in_domain TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Relation: works_in_domain');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS about_subject TYPE RELATION IN claim OUT subject SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS confidence ON about_subject TYPE option<float>;
			DEFINE FIELD IF NOT EXISTS imported_at ON about_subject TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Relation: about_subject');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS active_in_period TYPE RELATION IN thinker OUT period SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS confidence ON active_in_period TYPE option<float>;
			DEFINE FIELD IF NOT EXISTS imported_at ON active_in_period TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Relation: active_in_period');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS in_period TYPE RELATION IN claim OUT period SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS confidence ON in_period TYPE option<float>;
			DEFINE FIELD IF NOT EXISTS imported_at ON in_period TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Relation: in_period');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS related_to_subject TYPE RELATION IN subject OUT subject SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS weight ON related_to_subject TYPE option<float>;
			DEFINE FIELD IF NOT EXISTS reason ON related_to_subject TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS imported_at ON related_to_subject TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Relation: related_to_subject');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS authored_work TYPE RELATION IN thinker OUT work SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS confidence ON authored_work TYPE option<float>;
			DEFINE FIELD IF NOT EXISTS imported_at ON authored_work TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Relation: authored_work');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS cites_work TYPE RELATION IN claim OUT work SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS confidence ON cites_work TYPE option<float>;
			DEFINE FIELD IF NOT EXISTS imported_at ON cites_work TYPE datetime VALUE time::now();
		`);
		console.log('[SETUP] ✓ Relation: cites_work');

		// Verify schema by querying table counts
		console.log('\n[SETUP] Verifying schema...');

			const tables = [
				'source',
				'passage',
				'claim',
				'argument',
			'supports',
			'contradicts',
			'depends_on',
			'responds_to',
			'defines',
			'qualifies',
			'part_of',
			'review_audit_log',
			'query_cache',
			'link_ingestion_queue',
			'thinker',
			'influenced_by',
			'student_of',
			'authored',
			'unresolved_thinker_reference',
			'thinker_alias',
			'thinker_resolution_audit_log',
			'tradition',
			'subject',
			'period',
			'work',
			'belongs_to_tradition',
			'works_in_domain',
			'about_subject',
			'active_in_period',
			'in_period',
			'related_to_subject',
			'authored_work',
			'cites_work'
		];

		for (const table of tables) {
			const result = await db.query(`SELECT COUNT() as count FROM ${table}`);
			console.log(`[SETUP] Table '${table}': 0 records (ready)`);
		}

		console.log('\n✅ Schema created successfully!\n');
			console.log('Tables created:');
			console.log('  • source (metadata for philosophical sources)');
			console.log('  • passage (argument-native spans and role labels)');
		console.log('  • claim (individual philosophical claims with embeddings)');
		console.log('  • argument (philosophical arguments)');
		console.log('  • review_audit_log (moderation and promotion audit trail)');
		console.log('  • thinker (philosopher nodes from Wikidata)');
		console.log('  • unresolved_thinker_reference (unresolved name queue for review)');
		console.log('  • thinker_alias (canonical alias map with provenance)');
		console.log('  • thinker_resolution_audit_log (auto/manual resolver audit trail)');
		console.log('  • tradition (philosophical tradition nodes)');
		console.log('  • subject (domain/subject nodes)');
		console.log('  • period (timeline/era nodes)');
		console.log('  • work (work-level entities linked to sources)');
		console.log('\nRelation tables created:');
		console.log('  • supports (claim supports claim)');
		console.log('  • contradicts (claim contradicts claim)');
		console.log('  • depends_on (claim depends on claim)');
		console.log('  • responds_to (claim responds to claim)');
		console.log('  • defines (claim defines claim)');
		console.log('  • qualifies (claim qualifies claim)');
		console.log('  • part_of (claim is part of argument)');
		console.log('  • influenced_by (thinker influenced_by thinker)');
		console.log('  • student_of (thinker student_of thinker)');
		console.log('  • authored (thinker authored source)');
		console.log('  • belongs_to_tradition (thinker belongs_to_tradition tradition)');
		console.log('  • works_in_domain (thinker works_in_domain subject)');
		console.log('  • about_subject (claim about_subject subject)');
		console.log('  • active_in_period (thinker active_in_period period)');
		console.log('  • in_period (claim in_period period)');
		console.log('  • related_to_subject (subject related_to_subject subject)');
		console.log('  • authored_work (thinker authored_work work)');
		console.log('  • cites_work (claim cites_work work)\n');

		if (ownsConnection) {
			await db.close();
		}
	} catch (error) {
		console.error('[SETUP] Error:', error);
		if (ownsConnection) {
			await db.close();
		}
		throw error;
	}
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
	setupSchema().catch(() => {
		process.exit(1);
	});
}
