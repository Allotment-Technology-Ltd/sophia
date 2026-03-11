import { afterEach, describe, expect, it } from 'vitest';
import { clearLessonCacheForTests, getLessonCatalog } from '$lib/server/learn/content';

describe('learn content catalog', () => {
  afterEach(() => {
    clearLessonCacheForTests();
  });

  it('loads the seeded lessons with pedagogy constraints', async () => {
    const lessons = await getLessonCatalog();
    expect(lessons.length).toBeGreaterThanOrEqual(12);

    for (const lesson of lessons) {
      expect(lesson.objectives.length).toBeGreaterThanOrEqual(2);
      expect(lesson.references.length).toBeGreaterThanOrEqual(2);
      expect(lesson.examples.length).toBeGreaterThanOrEqual(1);

      for (const example of lesson.examples) {
        expect(Boolean(example.citation || example.source_url)).toBe(true);
      }

      if (lesson.section === 'daily') {
        expect(lesson.quiz.length).toBeGreaterThanOrEqual(1);
      }

      if (lesson.difficulty >= 3) {
        expect(lesson.guided_reading).toBeDefined();
      }
    }
  });
});
