import { json, type RequestHandler } from '@sveltejs/kit';
import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveReasoningModelRoute } from '$lib/server/vertex';
import { updateStoaProfile } from '$lib/server/stoa/profile-store';
import type { ArrivalReason, StartingPath, StanceType } from '$lib/types/stoa';

const assessmentSchema = z.object({
  philosophyLevel: z.enum(['novice', 'familiar', 'practised']),
  thinkingStyle: z.enum(['concrete', 'abstract', 'mixed']),
  emotionalPresence: z.enum(['present', 'defended', 'unclear']),
  primaryStruggleType: z.enum(['cognitive', 'emotional', 'existential', 'unclear']),
  beat3StanceSignal: z.enum(['sit_with', 'hold', 'guide']),
  assessmentConfidence: z.enum(['high', 'medium', 'low'])
});

function isArrivalReason(value: unknown): value is ArrivalReason {
  return (
    value === 'seeking_peace' ||
    value === 'seeking_direction' ||
    value === 'carrying_burden' ||
    value === 'uncertain'
  );
}

function isStartingPath(value: unknown): value is StartingPath {
  return value === 'garden' || value === 'colonnade' || value === 'sea_terrace';
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const arrivalReason = (body as Record<string, unknown>).arrivalReason;
  const startingPath = (body as Record<string, unknown>).startingPath;
  const beat3Choice = (body as Record<string, unknown>).beat3Choice;
  const openingStruggle = (body as Record<string, unknown>).openingStruggle;
  const beat5Question = (body as Record<string, unknown>).beat5Question;
  const studentResponse = (body as Record<string, unknown>).studentResponse;

  if (
    !isArrivalReason(arrivalReason) ||
    !isStartingPath(startingPath) ||
    typeof beat3Choice !== 'string' ||
    typeof beat5Question !== 'string' ||
    typeof studentResponse !== 'string'
  ) {
    return json({ error: 'Invalid assessment payload' }, { status: 400 });
  }

  const route = await resolveReasoningModelRoute({
    depthMode: 'quick',
    pass: 'generic',
    routeId: 'stoa.prologue.assessment'
  });

  const systemPrompt = `You are evaluating a new student's first exchange at a Stoic philosophy academy.

Student data:
- Arrival reason: ${arrivalReason}
- Starting path: ${startingPath}
- Beat 3 sub-choice: ${beat3Choice}
- Opening struggle (may be null): ${typeof openingStruggle === 'string' ? openingStruggle : 'null'}
- Assessment question asked: ${beat5Question}
- Student's response: ${studentResponse}

Respond ONLY with valid JSON matching this exact schema. No explanation, no preamble:
{
  "philosophyLevel": "novice" | "familiar" | "practised",
  "thinkingStyle": "concrete" | "abstract" | "mixed",
  "emotionalPresence": "present" | "defended" | "unclear",
  "primaryStruggleType": "cognitive" | "emotional" | "existential" | "unclear",
  "beat3StanceSignal": "sit_with" | "hold" | "guide",
  "assessmentConfidence": "high" | "medium" | "low"
}

Classification guide:
- philosophyLevel novice: no Stoic vocabulary, everyday framing
- philosophyLevel familiar: some Stoic concepts visible, may not apply correctly
- philosophyLevel practised: fluent with concepts, may reference texts
- emotionalPresence defended: intellectualises, avoids naming feelings, may use Stoic framing to suppress
- beat3StanceSignal sit_with: choice expressed acute feeling or weight
- beat3StanceSignal hold: choice expressed confusion or ambivalence
- beat3StanceSignal guide: choice expressed desire for movement or clarity`;

  const assessed = await generateObject({
    model: route.model,
    schema: assessmentSchema,
    system: systemPrompt,
    prompt: 'Return the classification JSON only.'
  });

  const suggestedOpeningStance: StanceType =
    assessed.object.beat3StanceSignal === 'sit_with'
      ? 'sit_with'
      : assessed.object.beat3StanceSignal === 'guide'
        ? 'guide'
        : 'hold';

  await updateStoaProfile(uid, {
    beat3Choice,
    philosophyLevel: assessed.object.philosophyLevel,
    thinkingStyle: assessed.object.thinkingStyle,
    emotionalPresence: assessed.object.emotionalPresence,
    primaryStruggleType: assessed.object.primaryStruggleType,
    suggestedOpeningStance
  });

  return json({
    philosophyLevel: assessed.object.philosophyLevel,
    suggestedOpeningStance
  });
};
