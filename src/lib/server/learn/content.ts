import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  FollowupExerciseSchema,
  GuidedReadingTaskSchema,
  LessonExampleSchema,
  LessonQuizItemSchema,
  LessonReferenceSchema,
  LessonUnitSchema,
  type LessonUnit
} from '$lib/types/learn';
import { validateLessonPedagogy } from '$lib/server/learn/pedagogy';

const LESSONS_DIR = join(process.cwd(), 'data', 'learn-lessons');

const LessonFrontmatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  section: z.enum(['daily', 'practice']),
  domain: z.enum(['ethics', 'politics', 'epistemology', 'metaphysics', 'logic']),
  difficulty: z.number().int().min(1).max(5),
  duration: z.string().min(1),
  objectives: z.array(z.string().min(1)).min(1),
  examples: z.array(LessonExampleSchema).default([]),
  quiz: z.array(LessonQuizItemSchema).default([]),
  followup_exercise: FollowupExerciseSchema.optional(),
  next_lesson_id: z.string().nullable().optional(),
  prerequisite_lesson_id: z.string().nullable().optional(),
  references: z.array(LessonReferenceSchema).default([]),
  guided_reading: GuidedReadingTaskSchema.optional()
});

let lessonCache: LessonUnit[] | null = null;

function parseFrontmatterBlock(raw: string): { frontmatter: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Lesson file is missing YAML frontmatter delimiters');
  }
  return {
    frontmatter: match[1].trim(),
    body: match[2].trim()
  };
}

function parseFrontmatter(frontmatter: string): z.infer<typeof LessonFrontmatterSchema> {
  // For v1 we use JSON-shaped YAML frontmatter for deterministic parsing.
  const parsed = JSON.parse(frontmatter) as unknown;
  return LessonFrontmatterSchema.parse(parsed);
}

async function loadLessonsFromDisk(): Promise<LessonUnit[]> {
  const entries = await readdir(LESSONS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(LESSONS_DIR, entry.name));

  const loaded = await Promise.all(
    files.map(async (filePath) => {
      const raw = await readFile(filePath, 'utf8');
      const { frontmatter, body } = parseFrontmatterBlock(raw);
      const meta = parseFrontmatter(frontmatter);
      return LessonUnitSchema.parse({
        ...meta,
        lesson_content_markdown: body
      });
    })
  );

  const byId = new Set(loaded.map((lesson) => lesson.id));
  for (const lesson of loaded) {
    if (lesson.next_lesson_id && !byId.has(lesson.next_lesson_id)) {
      throw new Error(`Lesson ${lesson.id} points to missing next_lesson_id=${lesson.next_lesson_id}`);
    }
    if (lesson.prerequisite_lesson_id && !byId.has(lesson.prerequisite_lesson_id)) {
      throw new Error(
        `Lesson ${lesson.id} points to missing prerequisite_lesson_id=${lesson.prerequisite_lesson_id}`
      );
    }
    const pedagogyIssues = validateLessonPedagogy(lesson);
    if (pedagogyIssues.length > 0) {
      const details = pedagogyIssues.map((issue) => `${issue.code}: ${issue.message}`).join(' | ');
      throw new Error(`Lesson ${lesson.id} failed pedagogy validation: ${details}`);
    }
  }

  return loaded.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getLessonCatalog(): Promise<LessonUnit[]> {
  if (lessonCache) return lessonCache;
  lessonCache = await loadLessonsFromDisk();
  return lessonCache;
}

export async function listLessonsBySection(
  section: 'daily' | 'practice',
  options?: { cursor?: number; limit?: number }
): Promise<{ lessons: LessonUnit[]; nextCursor: number | null }> {
  const catalog = await getLessonCatalog();
  const filtered = catalog.filter((lesson) => lesson.section === section);
  const cursor = Math.max(0, options?.cursor ?? 0);
  const limit = Math.max(1, Math.min(20, options?.limit ?? 8));
  const slice = filtered.slice(cursor, cursor + limit);
  const nextCursor = cursor + limit < filtered.length ? cursor + limit : null;
  return {
    lessons: slice,
    nextCursor
  };
}

export async function getLessonById(id: string): Promise<LessonUnit | null> {
  const catalog = await getLessonCatalog();
  return catalog.find((lesson) => lesson.id === id) ?? null;
}

export function clearLessonCacheForTests(): void {
  lessonCache = null;
}
