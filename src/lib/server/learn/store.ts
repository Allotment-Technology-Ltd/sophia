import { adminDb } from '$lib/server/firebase-admin';
import type { EssayFeedback, ShortAnswerMiniReview, SkillScores } from '$lib/types/learn';

interface CreateSubmissionInput {
  uid: string;
  type: 'essay' | 'short_answer';
  question: string;
  text: string;
  wordCount: number;
  lessonId?: string;
}

interface CreateVersionInput {
  uid: string;
  submissionId: string;
  versionNumber: number;
  question: string;
  text: string;
  wordCount: number;
  feedback?: EssayFeedback;
  shortReview?: ShortAnswerMiniReview;
}

function learnRoot(uid: string) {
  return adminDb.collection('users').doc(uid).collection('learn').doc('state');
}

function submissionsCol(uid: string) {
  return learnRoot(uid).collection('essay_submissions');
}

function versionsCol(uid: string) {
  return learnRoot(uid).collection('essay_versions');
}

function lessonProgressCol(uid: string) {
  return learnRoot(uid).collection('lesson_progress');
}

function progressSnapshotsCol(uid: string) {
  return learnRoot(uid).collection('progress_snapshots');
}

export async function createEssaySubmission(input: CreateSubmissionInput): Promise<{ id: string }> {
  const now = new Date().toISOString();
  const ref = await submissionsCol(input.uid).add({
    user_id: input.uid,
    type: input.type,
    question: input.question,
    text: input.text,
    word_count: input.wordCount,
    latest_version: 1,
    lesson_id: input.lessonId ?? null,
    created_at: now,
    updated_at: now
  });
  return { id: ref.id };
}

export async function updateEssaySubmission(
  uid: string,
  submissionId: string,
  updates: {
    latest_version?: number;
    text?: string;
    word_count?: number;
    summary_score?: number;
    dimension_scores?: SkillScores;
  }
): Promise<void> {
  await submissionsCol(uid).doc(submissionId).set(
    {
      ...updates,
      updated_at: new Date().toISOString()
    },
    { merge: true }
  );
}

export async function createEssayVersion(input: CreateVersionInput): Promise<{ id: string }> {
  const ref = await versionsCol(input.uid).add({
    submission_id: input.submissionId,
    version_number: input.versionNumber,
    question: input.question,
    text: input.text,
    word_count: input.wordCount,
    feedback: input.feedback ?? null,
    short_review: input.shortReview ?? null,
    created_at: new Date().toISOString()
  });
  return { id: ref.id };
}

export async function getEssaySubmission(uid: string, submissionId: string): Promise<Record<string, unknown> | null> {
  const snap = await submissionsCol(uid).doc(submissionId).get();
  if (!snap.exists) return null;
  return {
    id: snap.id,
    ...snap.data()
  };
}

export async function getLatestEssayVersion(uid: string, submissionId: string): Promise<Record<string, unknown> | null> {
  const snapshot = await versionsCol(uid)
    .where('submission_id', '==', submissionId)
    .orderBy('version_number', 'desc')
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return {
    id: doc.id,
    ...doc.data()
  };
}

export async function markLessonCompleted(uid: string, lessonId: string): Promise<void> {
  await lessonProgressCol(uid).doc(lessonId).set(
    {
      lesson_id: lessonId,
      completed: true,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    { merge: true }
  );
}

export async function isLessonCompleted(uid: string, lessonId: string): Promise<boolean> {
  const snap = await lessonProgressCol(uid).doc(lessonId).get();
  if (!snap.exists) return false;
  const data = snap.data() as { completed?: boolean } | undefined;
  return data?.completed === true;
}

export async function listCompletedLessonIds(uid: string): Promise<string[]> {
  const snapshot = await lessonProgressCol(uid).where('completed', '==', true).get();
  return snapshot.docs.map((doc) => doc.id);
}

export interface ProgressEssayRow {
  id: string;
  created_at: string;
  summary_score?: number;
  dimension_scores?: SkillScores;
}

export async function listProgressEssays(uid: string, limit = 100): Promise<ProgressEssayRow[]> {
  const snapshot = await submissionsCol(uid)
    .orderBy('updated_at', 'desc')
    .limit(Math.max(1, Math.min(limit, 200)))
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() as {
      updated_at?: string;
      created_at?: string;
      summary_score?: number;
      dimension_scores?: SkillScores;
    };
    return {
      id: doc.id,
      created_at: data.updated_at ?? data.created_at ?? new Date().toISOString(),
      summary_score: data.summary_score,
      dimension_scores: data.dimension_scores
    };
  });
}

export async function saveProgressSnapshot(
  uid: string,
  snapshot: {
    skills: SkillScores;
    recommendation: string;
    trajectory_delta: number;
    completed_units: string[];
    essay_history: string[];
  }
): Promise<void> {
  await progressSnapshotsCol(uid).add({
    user_id: uid,
    ...snapshot,
    updated_at: new Date().toISOString()
  });
}
