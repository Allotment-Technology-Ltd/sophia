export type StoicFrameworkId =
  | 'dichotomy_of_control'
  | 'premeditatio_malorum'
  | 'view_from_above'
  | 'amor_fati'
  | 'three_disciplines'
  | 'reserve_clause'
  | 'role_ethics'
  | 'discipline_of_impression'
  | 'sympatheia'
  | 'memento_mori';

export interface StoicFramework {
  id: StoicFrameworkId;
  label: string;
  shortDescription: string;
  useWhen: string[];
  avoidWhen: string[];
}

export const STOIC_FRAMEWORKS: StoicFramework[] = [
  {
    id: 'dichotomy_of_control',
    label: 'Dichotomy of Control',
    shortDescription: 'Separate what is up to you from what is not.',
    useWhen: ['decision pressure', 'anxiety about outcomes', 'blame spirals'],
    avoidWhen: ['acute grief opening minutes', 'needs immediate emotional containment']
  },
  {
    id: 'premeditatio_malorum',
    label: 'Premeditatio Malorum',
    shortDescription: 'Mentally rehearse obstacles to reduce shock and prepare action.',
    useWhen: ['anticipatory anxiety', 'difficult meetings', 'fear of uncertainty'],
    avoidWhen: ['catastrophic rumination already active']
  },
  {
    id: 'view_from_above',
    label: 'View from Above',
    shortDescription: 'Zoom out from ego pressure to larger context.',
    useWhen: ['ego injury', 'status panic', 'minor conflicts magnified'],
    avoidWhen: ['fresh trauma disclosure']
  },
  {
    id: 'amor_fati',
    label: 'Amor Fati',
    shortDescription: 'Practice willing acceptance of reality as it is.',
    useWhen: ['irreversible facts', 'setbacks that cannot be undone'],
    avoidWhen: ['used as bypass to skip legitimate grief']
  },
  {
    id: 'three_disciplines',
    label: 'Three Disciplines',
    shortDescription: 'Train desire, action, and assent together.',
    useWhen: ['habit change', 'character alignment', 'integrity drift'],
    avoidWhen: ['urgent emotional stabilization']
  },
  {
    id: 'reserve_clause',
    label: 'Reserve Clause',
    shortDescription: 'Commit to action while adding: if nothing prevents.',
    useWhen: ['planning under uncertainty', 'fragile dependencies'],
    avoidWhen: ['user avoiding commitment entirely']
  },
  {
    id: 'role_ethics',
    label: 'Role Ethics',
    shortDescription: 'Reason from duties within current roles.',
    useWhen: ['relationship conflict', 'professional obligations', 'family duties'],
    avoidWhen: ['role itself is abusive and needs safety planning first']
  },
  {
    id: 'discipline_of_impression',
    label: 'Discipline of Impression',
    shortDescription: 'Test first appearances before assenting to them.',
    useWhen: ['reactive assumptions', 'narrative certainty', 'mind reading'],
    avoidWhen: ['user asks for pure emotional witnessing']
  },
  {
    id: 'sympatheia',
    label: 'Sympatheia',
    shortDescription: 'Remember interdependence and shared humanity.',
    useWhen: ['resentment loops', 'dehumanizing conflict'],
    avoidWhen: ['user safety requires immediate boundary setting']
  },
  {
    id: 'memento_mori',
    label: 'Memento Mori',
    shortDescription: 'Use mortality awareness to clarify priorities.',
    useWhen: ['procrastination on meaningful action', 'values fog'],
    avoidWhen: ['panic spikes from mortality salience']
  }
];

export const STOIC_FRAMEWORK_NAME_MAP: Record<StoicFrameworkId, string> = STOIC_FRAMEWORKS.reduce(
  (acc, framework) => {
    acc[framework.id] = framework.label;
    return acc;
  },
  {} as Record<StoicFrameworkId, string>
);

