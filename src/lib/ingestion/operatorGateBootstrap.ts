/**
 * Client + server: sessionStorage bootstrap for Operator wizard when jumping from Inquiry corpus gates.
 */
export const GATE_BOOTSTRAP_STORAGE_KEY = 'sophia.operator.gateBootstrap.v1';
export const GATE_BOOTSTRAP_QUERY_FLAG = 'gateBootstrap';

export type OperatorGateBootstrapV1 = {
	v: 1;
	urls: string[];
	validateLlm: boolean;
	jobValidationTailOnly: boolean;
	mergeIntoRunningJob: boolean;
	jobForceReingest: boolean;
	notes: string;
	sourceCatalog?: 'sep' | 'gutenberg';
};

export type GateFollowUpAction = {
	id: string;
	title: string;
	description: string;
	href: string;
	hrefLabel: string;
	operatorBootstrap?: OperatorGateBootstrapV1;
};

/** LLM suggestions for failing coverage gates (Monitoring → Inquiry corpus). */
export type CoverageGateAiSuggestionItem = {
	gateTitle: string;
	urls: string[];
	rationale: string;
	wizardTip?: string;
};

export type CoverageGateAiSuggestionsPayload =
	| { ok: true; items: CoverageGateAiSuggestionItem[]; model: { provider: string; modelId: string } }
	| { ok: false; error: string };
