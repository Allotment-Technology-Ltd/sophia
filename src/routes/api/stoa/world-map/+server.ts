import { json, type RequestHandler } from '@sveltejs/kit';
import { query } from '$lib/server/db';
import { THINKER_REGISTRY } from '$lib/server/stoa/game/thinker-unlock';
import { getProgress } from '$lib/server/stoa/game/progress-store';
import { STOIC_FRAMEWORKS } from '$lib/server/stoa/frameworks';
import type { WorldMapNode, WorldMapEdge } from '$lib/types/stoa';

type ThinkerGraphRow = {
  id?: string;
  wikidata_id?: string;
  name?: string;
  birth_year?: number | null;
  death_year?: number | null;
};

type ThinkerEdgeRow = {
  in?: string;
  out?: string;
  strength?: string | number;
};

type FrameworkExposureRow = {
  framework_id?: string;
  exposure_count?: number;
  correct_application_count?: number;
  last_used?: string;
};

const THINKER_KEY_WORKS: Record<string, string[]> = {
  marcus: ['Meditations'],
  epictetus: ['Discourses', 'Enchiridion'],
  seneca: ['Letters from a Stoic', 'On the Shortness of Life'],
  chrysippus: ['On Passions (fragments)', 'On Providence (fragments)'],
  zeno: ['Republic (fragments)']
};

const FRAMEWORK_TO_THINKERS: Record<string, string[]> = {
  dichotomy_of_control: ['epictetus', 'marcus'],
  premeditatio_malorum: ['seneca'],
  view_from_above: ['marcus'],
  amor_fati: ['epictetus', 'marcus'],
  three_disciplines: ['epictetus'],
  reserve_clause: ['epictetus'],
  role_ethics: ['marcus', 'seneca'],
  discipline_of_impression: ['epictetus'],
  sympatheia: ['marcus', 'zeno'],
  memento_mori: ['seneca', 'marcus']
};

const CONCEPTS = [
  {
    id: 'concept:agency',
    label: 'Agency',
    description: 'Act where your will can genuinely move events.'
  },
  {
    id: 'concept:judgment',
    label: 'Judgment',
    description: 'Examine first impressions before assenting.'
  },
  {
    id: 'concept:virtue',
    label: 'Virtue',
    description: 'Orient action toward wisdom, justice, courage, and temperance.'
  }
] as const;

function normalizeRecordId(raw: string): string {
  return raw.includes(':') ? raw.split(':').slice(1).join(':') : raw;
}

function clampStrength(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0.15, Math.min(1, value));
  }
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (normalized === 'strong') return 0.95;
  if (normalized === 'weak') return 0.4;
  return 0.6;
}

function polarPosition(index: number, count: number, radius: number, y = 0): { x: number; y: number; z: number } {
  const angle = (Math.PI * 2 * index) / Math.max(count, 1);
  return {
    x: Math.cos(angle) * radius,
    y,
    z: Math.sin(angle) * radius
  };
}

export const GET: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const progress = await getProgress(uid);
  const unlockedThinkers = new Set(progress.unlockedThinkers);
  unlockedThinkers.add('marcus');

  const thinkerRows = await query<ThinkerGraphRow[]>(
    `SELECT id, wikidata_id, name, birth_year, death_year FROM thinker LIMIT 300`
  ).catch(() => []);
  const thinkerByNormalizedName = new Map(
    thinkerRows
      .filter((row) => typeof row.name === 'string' && row.name.trim().length > 0)
      .map((row) => [row.name!.trim().toLowerCase(), row] as const)
  );

  const frameworkExposureRows = await query<FrameworkExposureRow[]>(
    `SELECT framework_id, exposure_count, correct_application_count, last_used
     FROM stoa_framework_exposure
     WHERE user_id = <record<user>>$userRecord`,
    { userRecord: `user:${uid}` }
  ).catch(() => []);

  const activeFrameworks = new Set(progress.masteredFrameworks);
  for (const row of frameworkExposureRows) {
    if (!row.framework_id) continue;
    if ((row.exposure_count ?? 0) > 0 || (row.correct_application_count ?? 0) > 0) {
      activeFrameworks.add(row.framework_id);
    }
  }

  let latestFrameworkNodeId: string | null = null;
  const latestExposure = [...frameworkExposureRows]
    .filter((row) => typeof row.framework_id === 'string' && row.last_used)
    .sort((a, b) => Date.parse(b.last_used ?? '') - Date.parse(a.last_used ?? ''))[0];
  if (latestExposure?.framework_id) {
    latestFrameworkNodeId = `framework:${latestExposure.framework_id}`;
  } else {
    const latestTurn = await query<Array<{ frameworks_referenced?: string[] }>>(
      `SELECT frameworks_referenced
       FROM stoa_session_turn
       WHERE user_id = $userId
       ORDER BY timestamp DESC
       LIMIT 1`,
      { userId: uid }
    ).catch(() => []);
    const fromTurn = latestTurn[0]?.frameworks_referenced?.find((value) =>
      STOIC_FRAMEWORKS.some((framework) => framework.id === value)
    );
    latestFrameworkNodeId = fromTurn ? `framework:${fromTurn}` : null;
  }

  const thinkerNodes: WorldMapNode[] = THINKER_REGISTRY.map((thinker, index) => {
    const enriched = thinkerByNormalizedName.get(thinker.name.toLowerCase());
    const dates =
      typeof enriched?.birth_year === 'number' || typeof enriched?.death_year === 'number'
        ? `${enriched.birth_year ?? '?'}-${enriched.death_year ?? '?'}`
        : thinker.dates;
    const position = polarPosition(index, THINKER_REGISTRY.length, 9.4, 0);
    return {
      id: `thinker:${thinker.id}`,
      label: thinker.name,
      type: 'thinker',
      position,
      isUnlocked: unlockedThinkers.has(thinker.id),
      isActive: unlockedThinkers.has(thinker.id),
      details: {
        dates,
        portraitUrl: thinker.spritePath,
        keyWorks: THINKER_KEY_WORKS[thinker.id] ?? [],
        description: `${thinker.name} in the Stoic lineage.`
      }
    };
  });

  const frameworkNodes: WorldMapNode[] = STOIC_FRAMEWORKS.map((framework, index) => {
    const position = polarPosition(index, STOIC_FRAMEWORKS.length, 5.4, 1.3);
    return {
      id: `framework:${framework.id}`,
      label: framework.label,
      type: 'framework',
      position,
      isUnlocked: true,
      isActive: activeFrameworks.has(framework.id),
      details: {
        description: framework.shortDescription,
        misuseWarning: framework.avoidWhen[0] ?? '',
        keyWorks: framework.useWhen
      }
    };
  });

  const conceptNodes: WorldMapNode[] = CONCEPTS.map((concept, index) => {
    const position = polarPosition(index, CONCEPTS.length, 2.6, -1.2);
    return {
      id: concept.id,
      label: concept.label,
      type: 'concept',
      position,
      isUnlocked: true,
      isActive: false,
      details: {
        description: concept.description
      }
    };
  });

  const nodes = [...thinkerNodes, ...frameworkNodes, ...conceptNodes];

  const edges: WorldMapEdge[] = [];
  const edgeSet = new Set<string>();
  const pushEdge = (edge: WorldMapEdge): void => {
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push(edge);
  };

  for (const [frameworkId, thinkerIds] of Object.entries(FRAMEWORK_TO_THINKERS)) {
    for (const thinkerId of thinkerIds) {
      pushEdge({
        from: `thinker:${thinkerId}`,
        to: `framework:${frameworkId}`,
        type: 'taught',
        strength: 0.72
      });
    }
  }

  for (const concept of CONCEPTS) {
    for (const framework of STOIC_FRAMEWORKS) {
      if (
        framework.shortDescription.toLowerCase().includes(concept.label.toLowerCase()) ||
        framework.useWhen.some((item) => item.toLowerCase().includes(concept.label.toLowerCase()))
      ) {
        pushEdge({
          from: `framework:${framework.id}`,
          to: concept.id,
          type: 'supports',
          strength: 0.62
        });
      }
    }
  }

  const thinkerInfluenceRows = await query<ThinkerEdgeRow[]>(
    `SELECT in, out, strength
     FROM influenced_by
     WHERE in INSIDE (SELECT VALUE id FROM thinker)
       AND out INSIDE (SELECT VALUE id FROM thinker)
     LIMIT 400`
  ).catch(() => []);

  for (const row of thinkerInfluenceRows) {
    const fromRaw = typeof row.in === 'string' ? normalizeRecordId(row.in) : null;
    const toRaw = typeof row.out === 'string' ? normalizeRecordId(row.out) : null;
    if (!fromRaw || !toRaw) continue;
    const from = thinkerNodes.find((node) => {
      const labelLow = node.label.toLowerCase();
      return labelLow.includes(fromRaw.toLowerCase()) || node.id.endsWith(fromRaw.toLowerCase());
    });
    const to = thinkerNodes.find((node) => {
      const labelLow = node.label.toLowerCase();
      return labelLow.includes(toRaw.toLowerCase()) || node.id.endsWith(toRaw.toLowerCase());
    });
    if (!from || !to) continue;
    pushEdge({
      from: from.id,
      to: to.id,
      type: 'founded',
      strength: clampStrength(row.strength)
    });
  }

  if (edges.length === 0) {
    const fallbackOrder = ['zeno', 'chrysippus', 'seneca', 'epictetus', 'marcus'];
    for (let i = 0; i < fallbackOrder.length - 1; i += 1) {
      pushEdge({
        from: `thinker:${fallbackOrder[i]}`,
        to: `thinker:${fallbackOrder[i + 1]}`,
        type: 'founded',
        strength: 0.58
      });
    }
  }

  const currentPositionId =
    latestFrameworkNodeId ??
    thinkerNodes.find((node) => node.isUnlocked)?.id ??
    thinkerNodes[0]?.id ??
    null;
  if (currentPositionId) {
    const node = nodes.find((item) => item.id === currentPositionId);
    if (node) {
      node.isCurrentPosition = true;
      node.isActive = true;
    }
  }

  return json({
    nodes,
    edges
  });
};
