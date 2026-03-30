import type { ArrivalReason, StartingPath, StanceType } from '$lib/types/stoa';

// -- Beat 1 — STOA's first words (path-dependent) ---------------------
export const BEAT1_LINES: Record<StartingPath, string[]> = {
  garden: [
    'You found the quiet corner.',
    "Sit if you'd like. The water doesn't go anywhere."
  ],
  colonnade: ['You walked all the way in.', 'Most people stop at the entrance. Come — sit.'],
  sea_terrace: [
    'The sea at this hour.',
    "There's nowhere better to bring something heavy. Sit with me."
  ]
};

// -- Beat 2 — STOA's opening question (path-dependent) -----------------
export const BEAT2_LINES: Record<StartingPath, string[]> = {
  garden: [
    'Peace is an interesting thing to look for.',
    "Tell me — when was the last time you felt something close to it? Even briefly."
  ],
  colonnade: [
    'Finding your way.',
    "What does the path look like, when you imagine having found it? Don't tell me where it goes — tell me what it feels like to be on it."
  ],
  sea_terrace: [
    "You can put it down here if you like.",
    "I won't ask what it is yet. Just — what does it feel like to be carrying it?"
  ]
};

// -- Beat 3 — The key choice (world-initialising sub-branch) ----------
export interface Beat3Option {
  text: string;
  stanceSignal: StanceType;
  primaryStruggleHint: 'cognitive' | 'emotional' | 'existential';
}

export const BEAT3_OPTIONS: Record<ArrivalReason, Beat3Option[]> = {
  seeking_peace: [
    {
      text: "Honestly? I can't remember.",
      stanceSignal: 'sit_with',
      primaryStruggleHint: 'emotional'
    },
    {
      text: "There are moments. Small ones. But they don't last.",
      stanceSignal: 'hold',
      primaryStruggleHint: 'cognitive'
    },
    {
      text: "When I'm alone. When nobody needs anything from me.",
      stanceSignal: 'guide',
      primaryStruggleHint: 'existential'
    }
  ],
  seeking_direction: [
    {
      text: 'Clear. I want it to feel clear.',
      stanceSignal: 'guide',
      primaryStruggleHint: 'cognitive'
    },
    {
      text: "Like I'm doing what I'm supposed to be doing.",
      stanceSignal: 'hold',
      primaryStruggleHint: 'existential'
    },
    {
      text: "Like I'm moving instead of waiting.",
      stanceSignal: 'guide',
      primaryStruggleHint: 'cognitive'
    }
  ],
  carrying_burden: [
    {
      text: "Heavy. Like I can't breathe properly.",
      stanceSignal: 'sit_with',
      primaryStruggleHint: 'emotional'
    },
    {
      text: "Like it's mine to carry and I can't give it to anyone.",
      stanceSignal: 'sit_with',
      primaryStruggleHint: 'existential'
    },
    {
      text: "Like I keep thinking about it even when I don't want to.",
      stanceSignal: 'hold',
      primaryStruggleHint: 'cognitive'
    }
  ],
  uncertain: [
    {
      text: 'The quiet. I notice the quiet.',
      stanceSignal: 'sit_with',
      primaryStruggleHint: 'existential'
    },
    {
      text: 'How far away everything feels from here.',
      stanceSignal: 'hold',
      primaryStruggleHint: 'existential'
    },
    {
      text: "That I don't want to leave yet.",
      stanceSignal: 'sit_with',
      primaryStruggleHint: 'emotional'
    }
  ]
};

// -- Beat 4 — STOA responds to choice (exact, verbatim) ----------------
export const BEAT4_RESPONSES: Record<ArrivalReason, Record<string, string[]>> = {
  seeking_peace: {
    "Honestly? I can't remember.": ["That's honest.", `Not "rarely" — can't remember.`, "Let's start from there."],
    "There are moments. Small ones. But they don't last.": [
      'Small moments are still moments.',
      "We'll come back to that."
    ],
    "When I'm alone. When nobody needs anything from me.": [
      'Solitude as relief.',
      "Worth understanding whether that's rest — or something else.",
      'Sit with me a while.'
    ]
  },
  seeking_direction: {
    'Clear. I want it to feel clear.': ['Clarity.', "What's making it murky right now?"],
    "Like I'm doing what I'm supposed to be doing.": [
      '"Supposed to" is interesting.',
      'Whose sense of supposed-to?',
      "That's worth sitting with."
    ],
    "Like I'm moving instead of waiting.": [
      "You're waiting.",
      'For something specific, or just — waiting?',
      "Let's find out."
    ]
  },
  carrying_burden: {
    "Heavy. Like I can't breathe properly.": [
      "That's a real description.",
      'Not metaphor — physical.',
      "We'll sit with it before we try to move it."
    ],
    "Like it's mine to carry and I can't give it to anyone.": [
      "That feeling — that it's yours specifically — is worth examining.",
      'Not to take it from you.',
      'Just to look at it together.'
    ],
    "Like I keep thinking about it even when I don't want to.": [
      'Yes.',
      'Unresolved things do that.',
      'They keep asking for attention until they get it properly.'
    ]
  },
  uncertain: {
    'The quiet. I notice the quiet.': ['Good.', "That's already something.", 'Sit in it a moment longer.'],
    'How far away everything feels from here.': [
      'It is far.',
      'The academy sits at a certain remove from things.',
      "That's not an accident."
    ],
    "That I don't want to leave yet.": ["Then don't.", "That's enough for now."]
  }
};

// -- Beat 5 — Assessment question STOA asks before free text opens -----
export const BEAT5_QUESTIONS: Record<ArrivalReason, Record<string, string>> = {
  seeking_peace: {
    "Honestly? I can't remember.": "When was the last time you didn't feel like you needed to be somewhere else?",
    "There are moments. Small ones. But they don't last.": 'What makes them end, when they do?',
    "When I'm alone. When nobody needs anything from me.": 'Is that rest, or something else?'
  },
  seeking_direction: {
    'Clear. I want it to feel clear.': "What's making it murky right now?",
    "Like I'm doing what I'm supposed to be doing.": 'Whose sense of supposed-to is it?',
    "Like I'm moving instead of waiting.": 'What exactly are you waiting for?'
  },
  carrying_burden: {
    "Heavy. Like I can't breathe properly.": 'Where does it sit in your body?',
    "Like it's mine to carry and I can't give it to anyone.": 'When did you decide it was yours alone?',
    "Like I keep thinking about it even when I don't want to.": 'What would it mean to stop — even for an hour?'
  },
  uncertain: {
    'The quiet. I notice the quiet.': 'What does it feel like to be in quiet right now?',
    'How far away everything feels from here.': 'Is that relief, or something lonelier?',
    "That I don't want to leave yet.": "What is it you don't want to go back to?"
  }
};

// Fallback if beat3Choice key not found
export const ASSESSMENT_QUESTIONS_FALLBACK: Record<StartingPath, string> = {
  garden: "When was the last time you didn't feel like you needed to be somewhere else?",
  colonnade: 'What would it mean to know you were on the right path?',
  sea_terrace: 'What would it look like to put it down, even for a few minutes?'
};

// -- Quest seeds — practice STOA names at end of Beat 6 ----------------
export const QUEST_SEEDS: Record<StartingPath, string> = {
  garden:
    "One thing worth trying this week: when you notice a moment of stillness — however small — don't reach past it. Just let it be there.",
  colonnade:
    'One thing to do before tomorrow: name one action that is entirely in your hands. Not what you hope will happen. What you can actually do.',
  sea_terrace:
    "One thing for tonight: write one sentence about what you're carrying. Not to solve it. Just to make it visible outside your own head."
};

// Closing line after Beat 6
export const BEAT6_CLOSING_LINE = 'The academy is open.';

// -- Returning student greetings ---------------------------------------
export interface ReturningGreetingContext {
  startingPath: StartingPath;
  daysSince: number;
  lastStance: StanceType | null;
  hasActiveQuest: boolean;
  activeQuestTitle?: string;
  recentCompletion?: string;
  totalSessions: number;
  isFirstQuestComplete: boolean;
}

export function selectReturningGreeting(ctx: ReturningGreetingContext): {
  variant: string;
  lines: string[];
} {
  if (ctx.isFirstQuestComplete) {
    return {
      variant: 'first_quest_milestone',
      lines: [
        'You finished it.',
        'Not the task — the sitting with it long enough to finish.',
        "That's different."
      ]
    };
  }
  if (ctx.recentCompletion) {
    return {
      variant: 'post_completion',
      lines: [`You finished ${ctx.recentCompletion}.`, 'How did it land?']
    };
  }
  if (ctx.daysSince > 30) {
    return {
      variant: 'very_long_absence',
      lines: ['Student.', "I wasn't certain you'd return.", 'What brought you back?']
    };
  }
  if (ctx.daysSince > 14) {
    return {
      variant: 'long_absence',
      lines: ['Student.', "It's been a while.", 'Sit.']
    };
  }
  if (ctx.lastStance === 'sit_with') {
    return {
      variant: 'post_heavy_session',
      lines: ['You look steadier.', 'Or perhaps the light is different today. Either way — sit.']
    };
  }
  if (ctx.hasActiveQuest && ctx.daysSince < 4) {
    return {
      variant: 'short_absence_active_quest',
      lines: ['Student.', 'Still turning it over?']
    };
  }
  return {
    variant: 'medium_absence',
    lines: ['Back again.', 'What happened since we spoke?']
  };
}
