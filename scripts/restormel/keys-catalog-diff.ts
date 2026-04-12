/**
 * Compare model id lists: @restormel/keys from npm (defaultProviders) vs
 * @restormel/contracts DEFAULT_MODEL_CATALOG (used by allowed-models / routing).
 *
 * Run from repo root: pnpm exec tsx scripts/restormel/keys-catalog-diff.ts
 */
import { defaultProviders } from '@restormel/keys';
import { DEFAULT_MODEL_CATALOG, type ReasoningProvider } from '@restormel/contracts/providers';

const KEYS_TO_SOPHIA: Record<string, ReasoningProvider> = {
  google: 'vertex'
};

function sophiaProviderForKeysId(id: string): ReasoningProvider | null {
  const mapped = KEYS_TO_SOPHIA[id];
  if (mapped) return mapped;
  if (id in DEFAULT_MODEL_CATALOG) return id as ReasoningProvider;
  return null;
}

function diffSets(a: Set<string>, b: Set<string>): { onlyA: string[]; onlyB: string[] } {
  const onlyA = [...a].filter((x) => !b.has(x)).sort();
  const onlyB = [...b].filter((x) => !a.has(x)).sort();
  return { onlyA, onlyB };
}

function main(): void {
  const lines: string[] = [];
  lines.push('# Restormel Keys vs contracts catalog diff');
  lines.push('');
  lines.push(
    'Source A: `@restormel/keys` `defaultProviders[].models` (workspace dependency from npm).'
  );
  lines.push('Source B: `@restormel/contracts` `DEFAULT_MODEL_CATALOG` (Sophia allowed-models candidates).');
  lines.push('');
  lines.push('| Keys provider id | Sophia provider | Only in Keys | Only in contracts |');
  lines.push('| --- | --- | --- | --- |');

  for (const p of defaultProviders) {
    const sophia = sophiaProviderForKeysId(p.id);
    if (!sophia) {
      lines.push(
        `| \`${p.id}\` | _(not in reasoning catalog)_ | ${p.models?.length ?? 0} models in Keys | — |`
      );
      continue;
    }

    const keysModels = new Set((p.models ?? []).map(String));
    const contractModels = new Set((DEFAULT_MODEL_CATALOG[sophia] ?? []).map(String));
    const { onlyA: onlyKeys, onlyB: onlyContracts } = diffSets(keysModels, contractModels);

    const ok = onlyKeys.length === 0 && onlyContracts.length === 0;
    const keysCell = ok ? '—' : onlyKeys.map((m) => `\`${m}\``).join(', ') || '—';
    const conCell = ok ? '—' : onlyContracts.map((m) => `\`${m}\``).join(', ') || '—';
    lines.push(`| \`${p.id}\` | \`${sophia}\` | ${keysCell} | ${conCell} |`);
  }

  lines.push('');
  lines.push('## Next steps');
  lines.push('');
  lines.push('1. Bump vendored `@restormel/keys` / `@restormel/keys-svelte` tarballs when upstream releases (see `docs/local/restormel-integration/keys-catalog-sync.md`).');
  lines.push('2. For each row with differences, merge new model ids into Restormel Keys `packages/contracts/src/providers.ts` (`DEFAULT_MODEL_CATALOG`), publish `@restormel/contracts`, bump SOPHIA.');
  lines.push('3. Keep embedding / non-chat ids (e.g. Vertex `text-embedding-*`) in contracts even if Keys omits them.');
  lines.push('4. Re-run `pnpm run check` and allowed-models tests after edits.');
  lines.push('');

  process.stdout.write(lines.join('\n'));
}

main();
