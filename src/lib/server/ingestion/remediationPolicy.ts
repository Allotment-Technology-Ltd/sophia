import { z } from 'zod';

/**
 * Optional aggregate policy for remediation (extend with env-driven defaults in ingest).
 */
export const RemediationPolicySchema = z.object({
	skip_repair: z.boolean().optional(),
	force_relations_rerun: z.boolean().optional(),
	force_revalidate: z.boolean().optional()
});

export type RemediationPolicy = z.infer<typeof RemediationPolicySchema>;

export function parseRemediationPolicyJson(raw: string | null | undefined): RemediationPolicy | null {
	if (!raw?.trim()) return null;
	try {
		const v = JSON.parse(raw) as unknown;
		const p = RemediationPolicySchema.safeParse(v);
		return p.success ? p.data : null;
	} catch {
		return null;
	}
}
