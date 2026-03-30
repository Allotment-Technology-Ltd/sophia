<script lang="ts">
  import { onMount } from 'svelte';
  import { getIdToken } from '$lib/authClient';
  import { renderMarkdown } from '$lib/utils/markdown';
  import { formatWordRange, resolveShortReviewWordRange } from '$lib/utils/learnWordRange';
  import type { EssayFeedback, LessonUnit, ShortAnswerMiniReview, SkillScores } from '$lib/types/learn';

  type Section = 'daily' | 'practice' | 'submit' | 'progress';
  const PRACTICE_ESSAYS_COMING_SOON = true;
  const SUBMIT_ESSAYS_COMING_SOON = true;

  let activeSection = $state<Section>('daily');
  let dailyLessons = $state<LessonUnit[]>([]);
  let practiceLessons = $state<LessonUnit[]>([]);
  let selectedLesson = $state<LessonUnit | null>(null);
  let reviewedLessons = $state<Record<string, boolean>>({});

  let lessonLoading = $state(false);
  let lessonError = $state('');

  let shortQuestion = $state('');
  let shortResponseText = $state('');
  let shortSubmitting = $state(false);
  let shortResult = $state<ShortAnswerMiniReview | null>(null);
  let shortSubmissionId = $state<string | null>(null);
  let shortError = $state('');

  let dailyQuestion = $state('');
  let dailyResponseText = $state('');
  let dailySubmitting = $state(false);
  let dailyResult = $state<ShortAnswerMiniReview | null>(null);
  let dailySubmissionId = $state<string | null>(null);
  let dailyError = $state('');
  let dailyQuizSelections = $state<Record<string, string>>({});
  let dailyQuizChecked = $state<Record<string, boolean>>({});
  let dailyPrimerReviewed = $state<Record<string, boolean>>({});
  let practiceQuizSelections = $state<Record<string, string>>({});
  let practiceQuizChecked = $state<Record<string, boolean>>({});

  let essayQuestion = $state('');
  let essayText = $state('');
  let essaySubmitting = $state(false);
  let essayError = $state('');
  let essaySubmissionId = $state<string | null>(null);
  let essayFeedback = $state<EssayFeedback | null>(null);
  let essayVersionNumber = $state<number | null>(null);

  let revisedText = $state('');
  let revising = $state(false);
  let reviseError = $state('');

  let progressLoading = $state(false);
  let progressError = $state('');
  let progressRecommendation = $state('');
  let progressSkills = $state<SkillScores | null>(null);
  let progressCompletedUnits = $state<string[]>([]);
  let progressEssayCount = $state(0);
  let progressTrajectory = $state(0);
  let learnEntitlements = $state<{
    tier: 'free' | 'pro' | 'premium';
    monthKey: string;
    microLessonsUsed: number;
    shortReviewsUsed: number;
    essayReviewsUsed: number;
    microLessonsRemaining: number | null;
    shortReviewsRemaining: number | null;
    essayReviewsRemaining: number | null;
    scholarCreditsBalance: number;
    scholarCreditsSpent: number;
  } | null>(null);

  const sectionLabels: Record<Section, string> = {
    daily: 'Daily Drills',
    practice: 'Practice Essays',
    submit: 'Submit Essay',
    progress: 'My Progress'
  };

  interface LearningPathStage {
    title: string;
    focus: string;
    unlockCriteria: string;
  }

  const learningPath: LearningPathStage[] = [
    {
      title: 'Orientation',
      focus: 'Understand claim, premise, and conclusion through guided drills.',
      unlockCriteria: 'Start here'
    },
    {
      title: 'Foundation',
      focus: 'Build reliable argument structure and basic objection handling.',
      unlockCriteria: 'Complete 2 lessons'
    },
    {
      title: 'Argument Builder',
      focus: 'Use counterexamples, competing frameworks, and guided reading chunks.',
      unlockCriteria: 'Complete 5 lessons'
    },
    {
      title: 'Essay Apprentice',
      focus: 'Produce short and medium arguments with dialectical revisions.',
      unlockCriteria: 'Complete 8 lessons + 1 essay review'
    },
    {
      title: 'Degree-Level Writer',
      focus: 'Write sustained essays with clear thesis, objections, and synthesis.',
      unlockCriteria: 'Complete 10 lessons + 3 essay reviews + critique depth >= 70'
    }
  ];

  interface LessonDifficultyGroup {
    difficulty: number;
    lessons: LessonUnit[];
  }

  function sortLessonsByDifficulty(lessons: LessonUnit[]): LessonUnit[] {
    return [...lessons].sort((a, b) => {
      if (a.difficulty !== b.difficulty) return a.difficulty - b.difficulty;
      return a.title.localeCompare(b.title);
    });
  }

  function groupLessonsByDifficulty(lessons: LessonUnit[]): LessonDifficultyGroup[] {
    const buckets = new Map<number, LessonUnit[]>();
    for (const lesson of sortLessonsByDifficulty(lessons)) {
      const grouped = buckets.get(lesson.difficulty) ?? [];
      grouped.push(lesson);
      buckets.set(lesson.difficulty, grouped);
    }
    return Array.from(buckets.entries())
      .sort(([left], [right]) => left - right)
      .map(([difficulty, groupedLessons]) => ({
        difficulty,
        lessons: groupedLessons
      }));
  }

  function difficultyBandLabel(difficulty: number): string {
    if (difficulty <= 1) return 'Foundation';
    if (difficulty === 2) return 'Developing';
    if (difficulty === 3) return 'Intermediate';
    if (difficulty === 4) return 'Advanced';
    return 'Mastery';
  }

  const orderedDailyLessons = $derived.by(() => sortLessonsByDifficulty(dailyLessons));
  const orderedPracticeLessons = $derived.by(() => sortLessonsByDifficulty(practiceLessons));
  const groupedDailyLessons = $derived.by(() => groupLessonsByDifficulty(dailyLessons));
  const groupedPracticeLessons = $derived.by(() => groupLessonsByDifficulty(practiceLessons));

  function dailyQuizSelectionKey(lessonId: string, quizIndex: number): string {
    return `${lessonId}:${quizIndex}`;
  }

  function setDailyQuizSelection(lessonId: string, quizIndex: number, option: string): void {
    dailyQuizSelections = {
      ...dailyQuizSelections,
      [dailyQuizSelectionKey(lessonId, quizIndex)]: option
    };
  }

  function getDailyQuizSelection(lessonId: string, quizIndex: number): string {
    return dailyQuizSelections[dailyQuizSelectionKey(lessonId, quizIndex)] ?? '';
  }

  function checkActiveDailyQuiz(): void {
    if (!activeDailyLesson) return;
    dailyQuizChecked = {
      ...dailyQuizChecked,
      [activeDailyLesson.id]: true
    };
  }

  function practiceQuizSelectionKey(lessonId: string, quizIndex: number): string {
    return `${lessonId}:${quizIndex}`;
  }

  function setPracticeQuizSelection(lessonId: string, quizIndex: number, option: string): void {
    practiceQuizSelections = {
      ...practiceQuizSelections,
      [practiceQuizSelectionKey(lessonId, quizIndex)]: option
    };
  }

  function getPracticeQuizSelection(lessonId: string, quizIndex: number): string {
    return practiceQuizSelections[practiceQuizSelectionKey(lessonId, quizIndex)] ?? '';
  }

  function checkActivePracticeQuiz(): void {
    if (!activePracticeLesson) return;
    practiceQuizChecked = {
      ...practiceQuizChecked,
      [activePracticeLesson.id]: true
    };
  }

  function stripMarkdown(markdown: string): string {
    return markdown
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/\n+/g, ' ')
      .trim();
  }

  function primerPreview(markdown: string, maxLength = 320): string {
    const normalized = stripMarkdown(markdown);
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength).trimEnd()}...`;
  }

  function isDailyPrimerReviewed(lessonId: string): boolean {
    return dailyPrimerReviewed[lessonId] === true;
  }

  function setDailyPrimerReviewed(lessonId: string, reviewed: boolean): void {
    dailyPrimerReviewed = {
      ...dailyPrimerReviewed,
      [lessonId]: reviewed
    };
  }

  function isDailyQuizAnswerCorrect(lesson: LessonUnit, quizIndex: number): boolean {
    const selected = getDailyQuizSelection(lesson.id, quizIndex).trim().toLowerCase();
    const expected = lesson.quiz[quizIndex]?.answer?.trim().toLowerCase() ?? '';
    return selected.length > 0 && selected === expected;
  }

  function isPracticeQuizAnswerCorrect(lesson: LessonUnit, quizIndex: number): boolean {
    const selected = getPracticeQuizSelection(lesson.id, quizIndex).trim().toLowerCase();
    const expected = lesson.quiz[quizIndex]?.answer?.trim().toLowerCase() ?? '';
    return selected.length > 0 && selected === expected;
  }

  const shortWordCount = $derived(shortResponseText.trim() ? shortResponseText.trim().split(/\s+/).filter(Boolean).length : 0);
  const dailyWordCount = $derived(dailyResponseText.trim() ? dailyResponseText.trim().split(/\s+/).filter(Boolean).length : 0);
  const essayWordCount = $derived(essayText.trim() ? essayText.trim().split(/\s+/).filter(Boolean).length : 0);
  const revisedWordCount = $derived(revisedText.trim() ? revisedText.trim().split(/\s+/).filter(Boolean).length : 0);
  const activeDailyLesson = $derived.by(() => {
    if (selectedLesson?.section === 'daily') return selectedLesson;
    return orderedDailyLessons[0] ?? null;
  });
  const activePracticeLesson = $derived.by(() => {
    if (selectedLesson?.section === 'practice') return selectedLesson;
    return orderedPracticeLessons[0] ?? null;
  });
  const activeDailyWordRange = $derived.by(() => resolveShortReviewWordRange(activeDailyLesson));
  const activePracticeWordRange = $derived.by(() => resolveShortReviewWordRange(activePracticeLesson));
  const dailyWordCountInRange = $derived.by(
    () => dailyWordCount >= activeDailyWordRange.min && dailyWordCount <= activeDailyWordRange.max
  );
  const shortWordCountInRange = $derived.by(
    () => shortWordCount >= activePracticeWordRange.min && shortWordCount <= activePracticeWordRange.max
  );
  const activeDailyQuizChecked = $derived.by(() => (activeDailyLesson ? dailyQuizChecked[activeDailyLesson.id] === true : false));
  const activeDailyQuizCount = $derived.by(() => activeDailyLesson?.quiz.length ?? 0);
  const activeDailyQuizCorrectCount = $derived.by(() => {
    if (!activeDailyLesson) return 0;
    return activeDailyLesson.quiz.reduce((count, _, index) => {
      return count + (isDailyQuizAnswerCorrect(activeDailyLesson, index) ? 1 : 0);
    }, 0);
  });
  const activeDailyQuizPassed = $derived.by(() => {
    if (!activeDailyLesson) return false;
    if (activeDailyLesson.quiz.length === 0) return true;
    return activeDailyQuizChecked && activeDailyQuizCorrectCount === activeDailyQuizCount;
  });
  const activeDailyCompleted = $derived.by(() =>
    activeDailyLesson ? progressCompletedUnits.includes(activeDailyLesson.id) : false
  );
  const activeDailyPrimerReviewed = $derived.by(() =>
    activeDailyLesson ? isDailyPrimerReviewed(activeDailyLesson.id) : false
  );
  const activeDailyPrimerPreview = $derived.by(() =>
    activeDailyLesson ? primerPreview(activeDailyLesson.lesson_content_markdown) : ''
  );
  const activePracticePrimerReviewed = $derived.by(() =>
    activePracticeLesson ? isLessonReviewed(activePracticeLesson.id) : false
  );
  const activePracticePrimerPreview = $derived.by(() =>
    activePracticeLesson ? primerPreview(activePracticeLesson.lesson_content_markdown) : ''
  );
  const activePracticeQuizChecked = $derived.by(() =>
    activePracticeLesson ? practiceQuizChecked[activePracticeLesson.id] === true : false
  );
  const activePracticeQuizCount = $derived.by(() => activePracticeLesson?.quiz.length ?? 0);
  const activePracticeQuizCorrectCount = $derived.by(() => {
    if (!activePracticeLesson) return 0;
    return activePracticeLesson.quiz.reduce((count, _, index) => {
      return count + (isPracticeQuizAnswerCorrect(activePracticeLesson, index) ? 1 : 0);
    }, 0);
  });
  const activePracticeQuizPassed = $derived.by(() => {
    if (!activePracticeLesson) return false;
    if (!isLessonUnlocked(activePracticeLesson) || !isLessonReviewed(activePracticeLesson.id)) return false;
    if (activePracticeLesson.quiz.length === 0) return true;
    return activePracticeQuizChecked && activePracticeQuizCorrectCount === activePracticeQuizCount;
  });
  const shortReviewUnlocked = $derived.by(() => activePracticeQuizPassed);
  const essayUnlocked = $derived.by(() =>
    activePracticeLesson ? isLessonUnlocked(activePracticeLesson) && isLessonReviewed(activePracticeLesson.id) : false
  );
  const activePracticeCompleted = $derived.by(() =>
    activePracticeLesson ? progressCompletedUnits.includes(activePracticeLesson.id) : false
  );
  const stageLessonPreviews = $derived.by(() => {
    const buckets: LessonUnit[][] = [[], [], [], [], []];
    const practice = orderedPracticeLessons;
    const stageFourCount = practice.length > 1 ? Math.max(1, Math.ceil(practice.length * 0.67)) : practice.length;
    const stageFourIds = new Set(practice.slice(0, stageFourCount).map((lesson) => lesson.id));

    for (const lesson of orderedDailyLessons) {
      if (lesson.difficulty === 1 && !lesson.prerequisite_lesson_id) {
        buckets[0].push(lesson);
      } else if (lesson.difficulty === 1) {
        buckets[1].push(lesson);
      } else {
        buckets[2].push(lesson);
      }
    }

    for (const lesson of practice) {
      if (stageFourIds.has(lesson.id)) {
        buckets[3].push(lesson);
      } else {
        buckets[4].push(lesson);
      }
    }

    return buckets;
  });
  const currentLearningStageIndex = $derived.by(() => {
    const completed = progressCompletedUnits.length;
    const essays = progressEssayCount;
    const critiqueDepth = progressSkills?.critique_depth ?? 0;
    if (completed >= 10 && essays >= 3 && critiqueDepth >= 70) return 4;
    if (completed >= 8 && essays >= 1) return 3;
    if (completed >= 5) return 2;
    if (completed >= 2) return 1;
    return 0;
  });

  async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await getIdToken();
    if (!token) throw new Error('Sign in required');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(path, { ...init, headers });
  }

  async function fetchLessons(): Promise<void> {
    lessonLoading = true;
    lessonError = '';
    try {
      const [dailyRes, practiceRes] = await Promise.all([
        authFetch('/api/learn/lessons?section=daily'),
        authFetch('/api/learn/lessons?section=practice')
      ]);
      const dailyBody = await dailyRes.json();
      const practiceBody = await practiceRes.json();
      if (!dailyRes.ok) throw new Error(dailyBody?.error || 'Failed to load daily lessons');
      if (!practiceRes.ok) throw new Error(practiceBody?.error || 'Failed to load practice lessons');
      dailyLessons = Array.isArray(dailyBody.lessons) ? dailyBody.lessons : [];
      practiceLessons = Array.isArray(practiceBody.lessons) ? practiceBody.lessons : [];
      const firstDaily = sortLessonsByDifficulty(dailyLessons)[0] ?? null;
      const firstPractice = sortLessonsByDifficulty(practiceLessons)[0] ?? null;
      if (!selectedLesson) {
        selectedLesson = firstDaily ?? firstPractice;
      }
      if (firstDaily && !dailyQuestion) {
        dailyQuestion = firstDaily.followup_exercise?.question ?? firstDaily.title;
      }
      if (firstPractice && !shortQuestion) {
        shortQuestion = firstPractice.followup_exercise?.question ?? firstPractice.title;
      }
      if (firstPractice && !essayQuestion) {
        essayQuestion = firstPractice.followup_exercise?.question ?? firstPractice.title;
      }
    } catch (err) {
      lessonError = err instanceof Error ? err.message : String(err);
    } finally {
      lessonLoading = false;
    }
  }

  async function fetchProgress(): Promise<void> {
    progressLoading = true;
    progressError = '';
    try {
      const res = await authFetch('/api/learn/progress');
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Failed to load progress');
      progressSkills = body.skills ?? null;
      progressRecommendation = body.recommendation ?? '';
      progressCompletedUnits = Array.isArray(body.completed_units) ? body.completed_units : [];
      progressEssayCount = Number(body.essay_count ?? 0);
      progressTrajectory = Number(body.trajectory_delta ?? 0);
      learnEntitlements = body.learn_entitlements ?? null;
    } catch (err) {
      progressError = err instanceof Error ? err.message : String(err);
    } finally {
      progressLoading = false;
    }
  }

  async function fetchLearnEntitlements(): Promise<void> {
    try {
      const res = await authFetch('/api/learn/entitlements');
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Failed to load learn limits');
      learnEntitlements = body.summary ?? null;
    } catch {
      // Keep Learn usable even if entitlements fetch fails.
    }
  }

  async function submitDailyDrillReview(): Promise<void> {
    if (!activeDailyLesson) return;

    dailySubmitting = true;
    dailyError = '';
    dailyResult = null;
    dailySubmissionId = null;
    try {
      const prompt = dailyQuestion.trim() || activeDailyLesson.followup_exercise?.question || activeDailyLesson.title;
      const res = await authFetch('/api/learn/short-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: prompt,
          response_text: dailyResponseText,
          lesson_id: activeDailyLesson.id
        })
      });
      const body = await res.json();
      if (!res.ok) {
        if (body?.learn_entitlements) learnEntitlements = body.learn_entitlements;
        throw new Error(body?.error || 'Daily drill review failed');
      }
      dailyResult = body.review ?? null;
      dailySubmissionId = body.submission_id ?? null;
      if (body.learn_entitlements) learnEntitlements = body.learn_entitlements;
      await fetchProgress();
    } catch (err) {
      dailyError = err instanceof Error ? err.message : String(err);
    } finally {
      dailySubmitting = false;
    }
  }

  async function submitShortReview(): Promise<void> {
    if (PRACTICE_ESSAYS_COMING_SOON) return;
    shortSubmitting = true;
    shortError = '';
    shortResult = null;
    shortSubmissionId = null;
    try {
      const res = await authFetch('/api/learn/short-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: shortQuestion,
          response_text: shortResponseText,
          lesson_id: selectedLesson?.id
        })
      });
      const body = await res.json();
      if (!res.ok) {
        if (body?.learn_entitlements) learnEntitlements = body.learn_entitlements;
        throw new Error(body?.error || 'Short review failed');
      }
      shortResult = body.review ?? null;
      shortSubmissionId = body.submission_id ?? null;
      if (body.learn_entitlements) learnEntitlements = body.learn_entitlements;
      await fetchProgress();
    } catch (err) {
      shortError = err instanceof Error ? err.message : String(err);
    } finally {
      shortSubmitting = false;
    }
  }

  async function submitEssay(): Promise<void> {
    if (SUBMIT_ESSAYS_COMING_SOON) return;
    essaySubmitting = true;
    essayError = '';
    essayFeedback = null;
    essaySubmissionId = null;
    essayVersionNumber = null;
    reviseError = '';
    revisedText = '';
    try {
      const res = await authFetch('/api/learn/essay/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: essayQuestion,
          text: essayText,
          lesson_id: selectedLesson?.section === 'practice' ? selectedLesson.id : undefined
        })
      });
      const body = await res.json();
      if (!res.ok) {
        if (body?.learn_entitlements) learnEntitlements = body.learn_entitlements;
        throw new Error(body?.error || 'Essay review failed');
      }
      essayFeedback = body.feedback ?? null;
      essaySubmissionId = body.submission_id ?? null;
      essayVersionNumber = body.version_number ?? null;
      if (body.learn_entitlements) learnEntitlements = body.learn_entitlements;
      revisedText = essayText;
      await fetchProgress();
    } catch (err) {
      essayError = err instanceof Error ? err.message : String(err);
    } finally {
      essaySubmitting = false;
    }
  }

  async function applySuggestions(): Promise<void> {
    if (SUBMIT_ESSAYS_COMING_SOON) return;
    if (!essaySubmissionId) return;
    revising = true;
    reviseError = '';
    try {
      const res = await authFetch(`/api/learn/essay/${essaySubmissionId}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revised_text: revisedText,
          question: essayQuestion
        })
      });
      const body = await res.json();
      if (!res.ok) {
        if (body?.learn_entitlements) learnEntitlements = body.learn_entitlements;
        throw new Error(body?.error || 'Revision failed');
      }
      essayFeedback = body.feedback ?? null;
      essayVersionNumber = body.version_number ?? null;
      if (body.learn_entitlements) learnEntitlements = body.learn_entitlements;
      await fetchProgress();
    } catch (err) {
      reviseError = err instanceof Error ? err.message : String(err);
    } finally {
      revising = false;
    }
  }

  function openLesson(lesson: LessonUnit): void {
    selectedLesson = lesson;
    shortQuestion = lesson.followup_exercise?.question ?? lesson.title;
    if (lesson.section === 'practice') {
      activeSection = 'practice';
      essayQuestion = lesson.followup_exercise?.question ?? lesson.title;
      shortResponseText = '';
      shortError = '';
      shortResult = null;
      shortSubmissionId = null;
    } else {
      dailyQuestion = lesson.followup_exercise?.question ?? lesson.title;
      dailyResponseText = '';
      dailyError = '';
      dailyResult = null;
      dailySubmissionId = null;
    }
  }

  function isLessonUnlocked(lesson: LessonUnit): boolean {
    const prerequisite = lesson.prerequisite_lesson_id;
    if (!prerequisite) return true;
    return progressCompletedUnits.includes(prerequisite);
  }

  function isLessonReviewed(lessonId: string): boolean {
    return reviewedLessons[lessonId] === true;
  }

  function setLessonReviewed(lessonId: string, checked: boolean): void {
    reviewedLessons = {
      ...reviewedLessons,
      [lessonId]: checked
    };
  }

  onMount(() => {
    void fetchLessons();
    void fetchProgress();
    void fetchLearnEntitlements();
  });
</script>

<svelte:head>
  <title>SOPHIA Learn</title>
  <meta
    name="description"
    content="SOPHIA Learn: daily philosophy drills, practice essays, dialectical essay feedback, and progress analytics."
  />
</svelte:head>

<main class="learn-page">
  <header class="hero">
    <p class="eyebrow">Learn</p>
    <h1>Build philosophical reasoning with guided dialectics.</h1>
    <p>Progress from micro-skills to full essay review through Analysis, Critique, and Synthesis.</p>
  </header>

  <nav class="subnav" aria-label="Learn sections">
    {#each (Object.keys(sectionLabels) as Section[]) as section}
      <button class="subnav-btn" class:is-active={activeSection === section} onclick={() => activeSection = section}>
        {sectionLabels[section]}
      </button>
    {/each}
  </nav>

  <section class="journey" aria-label="Learning progression pathway">
    <header class="journey-header">
      <h2>Philosophy Pathway: Beginner to Degree-Level Writing</h2>
      <p>
        Current stage: <strong>Stage {currentLearningStageIndex + 1} — {learningPath[currentLearningStageIndex].title}</strong>
      </p>
    </header>
    <div class="journey-grid">
      {#each learningPath as stage, stageIndex (stage.title)}
        <article
          class="journey-stage"
          class:is-complete={stageIndex < currentLearningStageIndex}
          class:is-current={stageIndex === currentLearningStageIndex}
        >
          <p class="journey-step">Stage {stageIndex + 1}</p>
          <h3>{stage.title}</h3>
          <p>{stage.focus}</p>
          <p class="meta">Unlock: {stage.unlockCriteria}</p>
          {#if stageIndex >= 1}
            <div class="journey-preview">
              <p class="journey-preview-label">Preview Lessons</p>
              {#if stageLessonPreviews[stageIndex]?.length > 0}
                <ul>
                  {#each stageLessonPreviews[stageIndex].slice(0, 5) as lesson (lesson.id)}
                    <li>{lesson.title}</li>
                  {/each}
                </ul>
              {:else}
                <p class="meta">New stage lessons coming soon.</p>
              {/if}
            </div>
          {/if}
        </article>
      {/each}
    </div>
  </section>

  {#if learnEntitlements}
    <section class="entitlement-banner">
      <p>
        <strong>{learnEntitlements.tier.toUpperCase()}</strong> ·
        Lessons {learnEntitlements.microLessonsUsed}/{learnEntitlements.microLessonsRemaining === null ? '∞' : learnEntitlements.microLessonsUsed + learnEntitlements.microLessonsRemaining} ·
        Short reviews {learnEntitlements.shortReviewsUsed}/{learnEntitlements.shortReviewsRemaining === null ? '∞' : learnEntitlements.shortReviewsUsed + learnEntitlements.shortReviewsRemaining} ·
        Essay reviews {learnEntitlements.essayReviewsUsed}/{learnEntitlements.essayReviewsRemaining === null ? '∞' : learnEntitlements.essayReviewsUsed + learnEntitlements.essayReviewsRemaining} ·
        Scholar credits {learnEntitlements.scholarCreditsBalance}
      </p>
    </section>
  {/if}

  {#if lessonError}
    <p class="error">{lessonError}</p>
  {/if}

  {#if activeSection === 'daily'}
    <section class="split">
      <div class="cards">
        {#if lessonLoading}
          <p>Loading lessons...</p>
        {:else}
          {#each groupedDailyLessons as group (group.difficulty)}
            <section class="difficulty-group">
              <p class="difficulty-heading">Difficulty {group.difficulty} · {difficultyBandLabel(group.difficulty)}</p>
              {#each group.lessons as lesson (lesson.id)}
                <button class="lesson-card" class:is-selected={activeDailyLesson?.id === lesson.id} onclick={() => openLesson(lesson)}>
                  <p class="card-kicker">{lesson.category}</p>
                  <h2>{lesson.title}</h2>
                  <p class="card-meta">{lesson.duration} · Difficulty {lesson.difficulty}</p>
                </button>
              {/each}
            </section>
          {/each}
        {/if}
      </div>

      <article class="lesson-detail">
        {#if activeDailyLesson}
          <h2>{activeDailyLesson.title}</h2>
          <p class="meta">{activeDailyLesson.category} · {activeDailyLesson.duration}</p>
          <section class="daily-essentials">
            <h3>Step 0 · Essential Briefing</h3>
            <p class="meta">Start with the essentials first. Open deeper material only when needed.</p>
            <ul class="objective-list">
              {#each activeDailyLesson.objectives as objective}
                <li>{objective}</li>
              {/each}
            </ul>
            <p class="primer-preview">{activeDailyPrimerPreview}</p>
            <details class="expandable">
              <summary>Open full lesson primer</summary>
              <div class="markdown">{@html renderMarkdown(activeDailyLesson.lesson_content_markdown)}</div>
            </details>
            <label class="ready-check">
              <input
                type="checkbox"
                checked={activeDailyPrimerReviewed}
                onchange={(event) => setDailyPrimerReviewed(activeDailyLesson.id, (event.currentTarget as HTMLInputElement).checked)}
              />
              <span>I reviewed the essentials. Unlock concept check.</span>
            </label>
          </section>

          <details class="expandable supplemental">
            <summary>Optional: Example walkthrough and deeper reading</summary>
            <div>
              {#if activeDailyLesson.examples.length > 0}
                <section class="examples">
                  <h3>Philosophical Example Walkthrough</h3>
                  {#each activeDailyLesson.examples as example}
                    <article class="example-card">
                      <p><strong>Statement:</strong> {example.statement}</p>
                      <p><strong>Try this:</strong> {example.task}</p>
                      {#if example.citation}
                        <p class="meta">
                          {example.thinker ?? 'Source'}{#if example.work} · {example.work}{/if} ({example.citation})
                          {#if example.source_url}
                            · <a href={example.source_url} target="_blank" rel="noopener noreferrer">Open source</a>
                          {/if}
                        </p>
                      {/if}
                    </article>
                  {/each}
                </section>
              {/if}

              {#if activeDailyLesson.guided_reading}
                <section class="guided">
                  <h3>Guided Reading Chunks</h3>
                  <p class="meta">
                    {activeDailyLesson.guided_reading.source_title} — {activeDailyLesson.guided_reading.author}
                    ({activeDailyLesson.guided_reading.citation})
                  </p>
                  {#if activeDailyLesson.guided_reading.source_url}
                    <p><a href={activeDailyLesson.guided_reading.source_url} target="_blank" rel="noopener noreferrer">Open full text</a></p>
                  {/if}
                  {#each activeDailyLesson.guided_reading.chunks as chunk}
                    <details>
                      <summary>{chunk.heading} · {chunk.estimated_minutes} min</summary>
                      <p>{chunk.excerpt}</p>
                      <p><strong>Why it matters:</strong> {chunk.why_it_matters}</p>
                      <p><strong>Prompt:</strong> {chunk.discussion_prompt}</p>
                    </details>
                  {/each}
                </section>
              {/if}

              {#if activeDailyLesson.references.length > 0}
                <section class="refs">
                  <h3>Referenced Reading</h3>
                  <ul>
                    {#each activeDailyLesson.references as reference}
                      <li>
                        <strong>{reference.title}</strong> ({reference.citation})
                        {#if reference.note}<span> — {reference.note}</span>{/if}
                        {#if reference.url}
                          <a href={reference.url} target="_blank" rel="noopener noreferrer">Source</a>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </section>
              {/if}
            </div>
          </details>

          <section class="daily-drill-flow">
            <h3>Daily Drill Flow</h3>
            <div class="flow-steps">
              <p class="flow-step" class:is-complete={activeDailyPrimerReviewed}>0. Review essentials</p>
              <p class="flow-step" class:is-complete={activeDailyQuizPassed}>1. Quick concept check</p>
              <p class="flow-step" class:is-complete={Boolean(dailyResult)}>
                2. Reasoning sprint ({formatWordRange(activeDailyWordRange)} words)
              </p>
              <p class="flow-step" class:is-complete={activeDailyCompleted}>3. Reflection saved</p>
            </div>
          </section>

          {#if !activeDailyPrimerReviewed}
            <section class="quiz-box drill-locked">
              <h3>Step 1 · Interactive Concept Check</h3>
              <p class="meta">Complete Step 0 to unlock the concept check.</p>
            </section>
          {:else if activeDailyLesson.quiz.length > 0}
            <section class="quiz-box">
              <h3>Step 1 · Interactive Concept Check</h3>
              {#each activeDailyLesson.quiz as quizItem, quizIndex}
                <fieldset class="quiz-item">
                  <legend>Q{quizIndex + 1}. {quizItem.question}</legend>
                  <div class="quiz-options">
                    {#each quizItem.options as option}
                      <button
                        type="button"
                        class="option-pill"
                        class:is-selected={getDailyQuizSelection(activeDailyLesson.id, quizIndex) === option}
                        onclick={() => setDailyQuizSelection(activeDailyLesson.id, quizIndex, option)}
                      >
                        {option}
                      </button>
                    {/each}
                  </div>
                  {#if activeDailyQuizChecked}
                    <p class:quiz-ok={isDailyQuizAnswerCorrect(activeDailyLesson, quizIndex)} class:quiz-miss={!isDailyQuizAnswerCorrect(activeDailyLesson, quizIndex)}>
                      {#if isDailyQuizAnswerCorrect(activeDailyLesson, quizIndex)}
                        Correct.
                      {:else}
                        Not yet. Correct answer: {quizItem.answer}
                      {/if}
                    </p>
                  {/if}
                </fieldset>
              {/each}
              <button class="action secondary" onclick={checkActiveDailyQuiz}>Check Answers</button>
              {#if activeDailyQuizChecked}
                <p class="meta">Score: {activeDailyQuizCorrectCount} / {activeDailyQuizCount}</p>
                {#if !activeDailyQuizPassed}
                  <p class="error">Pass the concept check to unlock Step 2.</p>
                {/if}
              {/if}
            </section>
          {/if}

          {#if !activeDailyQuizPassed}
            <section class="daily-sprint drill-locked">
              <h3>Step 2 · Reasoning Sprint ({formatWordRange(activeDailyWordRange)} words)</h3>
              <p class="meta">Pass Step 1 to unlock the writing sprint and feedback.</p>
            </section>
          {:else}
            <section class="daily-sprint">
              <h3>Step 2 · Reasoning Sprint ({formatWordRange(activeDailyWordRange)} words)</h3>
              <p class="meta">
                Write a concise answer and get immediate dialectical coaching. Target range: {formatWordRange(activeDailyWordRange)} words.
              </p>
              <div class="prompt-display">
                <p class="prompt-label">Prompt</p>
                <p>{dailyQuestion || activeDailyLesson.followup_exercise?.question || activeDailyLesson.title}</p>
              </div>
              <label>
                Your Response
                <textarea
                  rows="7"
                  bind:value={dailyResponseText}
                  placeholder={`Aim for ${formatWordRange(activeDailyWordRange)} words...`}
                  disabled={!activeDailyQuizPassed}
                ></textarea>
              </label>
              <p class="meta">Word count: {dailyWordCount}</p>
              {#if dailyWordCount > 0 && !dailyWordCountInRange}
                <p class="error">Use {formatWordRange(activeDailyWordRange)} words for this sprint.</p>
              {/if}
              <button class="action" disabled={dailySubmitting || !activeDailyQuizPassed || !dailyWordCountInRange} onclick={submitDailyDrillReview}>
                Get Dialectical Coaching ->
              </button>
              {#if dailyError}
                <p class="error">{dailyError}</p>
              {/if}
              {#if dailyResult}
                <div class="feedback">
                  <h3>Daily Drill Feedback</h3>
                  <p><strong>Analysis:</strong> {dailyResult.analysis}</p>
                  <p><strong>Critique:</strong> {dailyResult.critique}</p>
                  <p><strong>Synthesis:</strong> {dailyResult.synthesis}</p>
                  <p><strong>Micro score:</strong> {dailyResult.micro_score} / 10</p>
                  <p>{dailyResult.encouragement}</p>
                  {#if dailySubmissionId}
                    <p class="meta">Saved as submission {dailySubmissionId}</p>
                  {/if}
                </div>
              {/if}
            </section>
          {/if}
        {:else}
          <p>Select a lesson to begin.</p>
        {/if}
      </article>
    </section>
  {/if}

  {#if activeSection === 'practice'}
    <section class="split">
      <div class="cards">
        {#each groupedPracticeLessons as group (group.difficulty)}
          <section class="difficulty-group">
            <p class="difficulty-heading">Difficulty {group.difficulty} · {difficultyBandLabel(group.difficulty)}</p>
            {#each group.lessons as lesson (lesson.id)}
              <button
                class="lesson-card"
                class:is-selected={activePracticeLesson?.id === lesson.id}
                class:is-locked={!isLessonUnlocked(lesson)}
                onclick={() => openLesson(lesson)}
              >
                <p class="card-kicker">{lesson.category}</p>
                <h2>{lesson.title}</h2>
                <p class="card-meta">{lesson.duration} · Difficulty {lesson.difficulty}</p>
                {#if lesson.prerequisite_lesson_id}
                  <p class="meta">
                    Prerequisite: {lesson.prerequisite_lesson_id}
                    {#if isLessonUnlocked(lesson)}
                      <span class="badge ok">ready</span>
                    {:else}
                      <span class="badge locked">locked</span>
                    {/if}
                  </p>
                {/if}
              </button>
            {/each}
          </section>
        {/each}
      </div>
      <article class="practice-box">
        {#if activePracticeLesson}
          {#if PRACTICE_ESSAYS_COMING_SOON}
            <section class="coming-soon-banner" role="status" aria-live="polite">
              <h3>Practice Essays Coming Soon</h3>
              <p>
                This section is currently in preview for demand and quality testing.
                You can explore lesson content now; interactive practice submission is temporarily disabled.
              </p>
            </section>
          {/if}
          <h2>{activePracticeLesson.title}</h2>
          <p class="meta">{activePracticeLesson.category} · {activePracticeLesson.duration}</p>
          <section class="practice-essentials">
            <h3>Step 0 · Essential Briefing</h3>
            <p class="meta">Start with the essentials first. Open deeper material only when needed.</p>
            <ul class="objective-list">
              {#each activePracticeLesson.objectives as objective}
                <li>{objective}</li>
              {/each}
            </ul>
            <p class="primer-preview">{activePracticePrimerPreview}</p>
            <details class="expandable">
              <summary>Open full lesson primer</summary>
              <div class="markdown">{@html renderMarkdown(activePracticeLesson.lesson_content_markdown)}</div>
            </details>
            {#if !isLessonUnlocked(activePracticeLesson)}
              <p class="error">
                Complete prerequisite lesson <strong>{activePracticeLesson.prerequisite_lesson_id}</strong> first.
              </p>
            {:else}
              <label class="ready-check">
                <input
                  type="checkbox"
                  checked={activePracticePrimerReviewed}
                  disabled={PRACTICE_ESSAYS_COMING_SOON}
                  onchange={(event) => setLessonReviewed(activePracticeLesson.id, (event.currentTarget as HTMLInputElement).checked)}
                />
                <span>I reviewed the essentials. Unlock concept check.</span>
              </label>
            {/if}
          </section>

          <details class="expandable supplemental">
            <summary>Optional: Example walkthrough and deeper reading</summary>
            <div>
              {#if activePracticeLesson.examples.length > 0}
                <section class="examples">
                  <h3>Philosophical Example Walkthrough</h3>
                  {#each activePracticeLesson.examples as example}
                    <article class="example-card">
                      <p><strong>Statement:</strong> {example.statement}</p>
                      <p><strong>Try this:</strong> {example.task}</p>
                      {#if example.citation}
                        <p class="meta">
                          {example.thinker ?? 'Source'}{#if example.work} · {example.work}{/if} ({example.citation})
                          {#if example.source_url}
                            · <a href={example.source_url} target="_blank" rel="noopener noreferrer">Open source</a>
                          {/if}
                        </p>
                      {/if}
                    </article>
                  {/each}
                </section>
              {/if}

              {#if activePracticeLesson.guided_reading}
                <section class="guided">
                  <h3>Guided Reading Chunks</h3>
                  <p class="meta">
                    {activePracticeLesson.guided_reading.source_title} — {activePracticeLesson.guided_reading.author}
                    ({activePracticeLesson.guided_reading.citation})
                  </p>
                  {#if activePracticeLesson.guided_reading.source_url}
                    <p><a href={activePracticeLesson.guided_reading.source_url} target="_blank" rel="noopener noreferrer">Open full text</a></p>
                  {/if}
                  {#each activePracticeLesson.guided_reading.chunks as chunk}
                    <details>
                      <summary>{chunk.heading} · {chunk.estimated_minutes} min</summary>
                      <p>{chunk.excerpt}</p>
                      <p><strong>Why it matters:</strong> {chunk.why_it_matters}</p>
                      <p><strong>Prompt:</strong> {chunk.discussion_prompt}</p>
                    </details>
                  {/each}
                </section>
              {/if}

              {#if activePracticeLesson.references.length > 0}
                <section class="refs">
                  <h3>Referenced Reading</h3>
                  <ul>
                    {#each activePracticeLesson.references as reference}
                      <li>
                        <strong>{reference.title}</strong> ({reference.citation})
                        {#if reference.note}<span> — {reference.note}</span>{/if}
                        {#if reference.url}
                          <a href={reference.url} target="_blank" rel="noopener noreferrer">Source</a>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </section>
              {/if}
            </div>
          </details>

          <section class="practice-drill-flow">
            <h3>Practice Essay Flow</h3>
            <div class="flow-steps">
              <p class="flow-step" class:is-complete={activePracticePrimerReviewed}>0. Review essentials</p>
              <p class="flow-step" class:is-complete={activePracticeQuizPassed}>1. Quick concept check</p>
              <p class="flow-step" class:is-complete={Boolean(shortResult)}>2. Practice paragraph + review</p>
              <p class="flow-step" class:is-complete={activePracticeCompleted}>3. Reflection saved</p>
            </div>
          </section>

          {#if PRACTICE_ESSAYS_COMING_SOON}
            <section class="quiz-box drill-locked">
              <h3>Step 1 · Interactive Concept Check</h3>
              <p class="meta">
                Coming soon. Practice interaction is temporarily disabled while we validate demand and scoring quality.
              </p>
            </section>
            <section class="daily-sprint drill-locked">
              <h3>Step 2 · Practice Essay Paragraph ({formatWordRange(activePracticeWordRange)} words)</h3>
              <p class="meta">
                Coming soon. You can still review the lesson primer, examples, and guided reading above.
              </p>
            </section>
          {:else if !isLessonUnlocked(activePracticeLesson)}
            <section class="quiz-box drill-locked">
              <h3>Step 1 · Interactive Concept Check</h3>
              <p class="meta">Complete prerequisite lesson <strong>{activePracticeLesson.prerequisite_lesson_id}</strong> to unlock Step 1.</p>
            </section>
          {:else if !activePracticePrimerReviewed}
            <section class="quiz-box drill-locked">
              <h3>Step 1 · Interactive Concept Check</h3>
              <p class="meta">Complete Step 0 to unlock the concept check.</p>
            </section>
          {:else if activePracticeLesson.quiz.length > 0}
            <section class="quiz-box">
              <h3>Step 1 · Interactive Concept Check</h3>
              {#each activePracticeLesson.quiz as quizItem, quizIndex}
                <fieldset class="quiz-item">
                  <legend>Q{quizIndex + 1}. {quizItem.question}</legend>
                  <div class="quiz-options">
                    {#each quizItem.options as option}
                      <button
                        type="button"
                        class="option-pill"
                        class:is-selected={getPracticeQuizSelection(activePracticeLesson.id, quizIndex) === option}
                        onclick={() => setPracticeQuizSelection(activePracticeLesson.id, quizIndex, option)}
                      >
                        {option}
                      </button>
                    {/each}
                  </div>
                  {#if activePracticeQuizChecked}
                    <p class:quiz-ok={isPracticeQuizAnswerCorrect(activePracticeLesson, quizIndex)} class:quiz-miss={!isPracticeQuizAnswerCorrect(activePracticeLesson, quizIndex)}>
                      {#if isPracticeQuizAnswerCorrect(activePracticeLesson, quizIndex)}
                        Correct.
                      {:else}
                        Not yet. Correct answer: {quizItem.answer}
                      {/if}
                    </p>
                  {/if}
                </fieldset>
              {/each}
              <button class="action secondary" onclick={checkActivePracticeQuiz}>Check Answers</button>
              {#if activePracticeQuizChecked}
                <p class="meta">Score: {activePracticeQuizCorrectCount} / {activePracticeQuizCount}</p>
                {#if !activePracticeQuizPassed}
                  <p class="error">Pass the concept check to unlock Step 2.</p>
                {/if}
              {/if}
            </section>
          {:else}
            <section class="quiz-box">
              <h3>Step 1 · Interactive Concept Check</h3>
              <p class="meta">No quiz configured for this lesson yet. Step 2 is unlocked once Step 0 is complete.</p>
            </section>
          {/if}

          {#if !shortReviewUnlocked}
            <section class="daily-sprint drill-locked">
              <h3>Step 2 · Practice Essay Paragraph ({formatWordRange(activePracticeWordRange)} words)</h3>
              {#if !isLessonUnlocked(activePracticeLesson)}
                <p class="meta">Complete prerequisite lesson first.</p>
              {:else if !activePracticePrimerReviewed}
                <p class="meta">Complete Step 0 to unlock writing and feedback.</p>
              {:else}
                <p class="meta">Pass Step 1 to unlock the writing task and feedback.</p>
              {/if}
            </section>
          {:else}
            <section class="daily-sprint">
              <h3>Step 2 · Practice Essay Paragraph ({formatWordRange(activePracticeWordRange)} words)</h3>
              <p class="meta">
                Write a concise paragraph and receive dialectical coaching. Target range: {formatWordRange(activePracticeWordRange)} words.
              </p>
              <div class="prompt-display">
                <p class="prompt-label">Prompt</p>
                <p>{shortQuestion || activePracticeLesson.followup_exercise?.question || activePracticeLesson.title}</p>
              </div>
              <label>
                Your Response
                <textarea
                  rows="8"
                  bind:value={shortResponseText}
                  placeholder={`Aim for ${formatWordRange(activePracticeWordRange)} words...`}
                  disabled={!shortReviewUnlocked}
                ></textarea>
              </label>
              <p class="meta">Word count: {shortWordCount}</p>
              {#if shortWordCount > 0 && !shortWordCountInRange}
                <p class="error">Use {formatWordRange(activePracticeWordRange)} words for this practice step.</p>
              {/if}
              <button class="action" disabled={shortSubmitting || !shortReviewUnlocked || !shortWordCountInRange} onclick={submitShortReview}>
                Begin Review ->
              </button>
              {#if shortError}
                <p class="error">{shortError}</p>
              {/if}
              {#if shortResult}
                <div class="feedback">
                  <h3>Practice Essay Feedback</h3>
                  <p><strong>Analysis:</strong> {shortResult.analysis}</p>
                  <p><strong>Critique:</strong> {shortResult.critique}</p>
                  <p><strong>Synthesis:</strong> {shortResult.synthesis}</p>
                  <p><strong>Micro score:</strong> {shortResult.micro_score} / 10</p>
                  <p>{shortResult.encouragement}</p>
                  {#if shortSubmissionId}
                    <p class="meta">Saved as submission {shortSubmissionId}</p>
                  {/if}
                </div>
              {/if}
            </section>
          {/if}
        {:else}
          <p>Select a practice lesson.</p>
        {/if}
      </article>
    </section>
  {/if}

  {#if activeSection === 'submit'}
    <section class="split">
      <div class="cards">
        {#each groupedPracticeLessons as group (group.difficulty)}
          <section class="difficulty-group">
            <p class="difficulty-heading">Difficulty {group.difficulty} · {difficultyBandLabel(group.difficulty)}</p>
            {#each group.lessons as lesson (lesson.id)}
              <button
                class="lesson-card"
                class:is-selected={activePracticeLesson?.id === lesson.id}
                class:is-locked={!isLessonUnlocked(lesson)}
                onclick={() => openLesson(lesson)}
              >
                <p class="card-kicker">{lesson.category}</p>
                <h2>{lesson.title}</h2>
                <p class="card-meta">{lesson.duration} · Difficulty {lesson.difficulty}</p>
                {#if lesson.prerequisite_lesson_id}
                  <p class="meta">
                    Prerequisite: {lesson.prerequisite_lesson_id}
                    {#if isLessonUnlocked(lesson)}
                      <span class="badge ok">ready</span>
                    {:else}
                      <span class="badge locked">locked</span>
                    {/if}
                  </p>
                {/if}
              </button>
            {/each}
          </section>
        {/each}
      </div>

      <section class="essay-box">
        {#if activePracticeLesson}
          {#if SUBMIT_ESSAYS_COMING_SOON}
            <section class="coming-soon-banner" role="status" aria-live="polite">
              <h3>Submit Essay Coming Soon</h3>
              <p>
                Long-form essay submission is currently paused for controlled testing.
                You can still preview prompts, references, and guided reading on this screen.
              </p>
            </section>
          {/if}
          <h2>Essay Tutor: {activePracticeLesson.title}</h2>
          <p>Before writing, review the lesson references and guided text chunks.</p>

          {#if activePracticeLesson.references.length > 0}
            <section class="refs">
              <h3>Core References</h3>
              <ul>
                {#each activePracticeLesson.references as reference}
                  <li>
                    <strong>{reference.title}</strong> ({reference.citation})
                    {#if reference.note}<span> — {reference.note}</span>{/if}
                    {#if reference.url}
                      <a href={reference.url} target="_blank" rel="noopener noreferrer">Source</a>
                    {/if}
                  </li>
                {/each}
              </ul>
            </section>
          {/if}

          {#if activePracticeLesson.guided_reading}
            <section class="guided">
              <h3>Guided Reading Chunks</h3>
              {#each activePracticeLesson.guided_reading.chunks as chunk}
                <details>
                  <summary>{chunk.heading} · {chunk.estimated_minutes} min</summary>
                  <p>{chunk.excerpt}</p>
                  <p><strong>Why it matters:</strong> {chunk.why_it_matters}</p>
                  <p><strong>Prompt:</strong> {chunk.discussion_prompt}</p>
                </details>
              {/each}
            </section>
          {/if}

          {#if !isLessonUnlocked(activePracticeLesson)}
            <p class="error">
              Complete prerequisite lesson <strong>{activePracticeLesson.prerequisite_lesson_id}</strong> first.
            </p>
          {:else}
            <label class="ready-check">
              <input
                type="checkbox"
                checked={isLessonReviewed(activePracticeLesson.id)}
                disabled={SUBMIT_ESSAYS_COMING_SOON}
                onchange={(event) => setLessonReviewed(activePracticeLesson.id, (event.currentTarget as HTMLInputElement).checked)}
              />
              <span>I completed the preparatory reading and examples. Unlock essay task.</span>
            </label>
          {/if}

          <h3>Submit Essay</h3>
          <p>Paste your essay or write directly below. You will receive structured analysis, critique, and synthesis feedback.</p>
          <label>
            Essay Prompt
            <textarea rows="3" bind:value={essayQuestion} placeholder="Question prompt" disabled={!essayUnlocked || SUBMIT_ESSAYS_COMING_SOON}></textarea>
          </label>
          <label>
            Essay (Markdown supported)
            <textarea rows="12" bind:value={essayText} placeholder="100-2000 words" disabled={!essayUnlocked || SUBMIT_ESSAYS_COMING_SOON}></textarea>
          </label>
          <p class="meta">Word count: {essayWordCount}</p>
          <button class="action" disabled={essaySubmitting || !essayUnlocked || SUBMIT_ESSAYS_COMING_SOON} onclick={submitEssay}>Begin Review -></button>
          {#if SUBMIT_ESSAYS_COMING_SOON}
            <p class="meta">Coming soon: essay submission will be enabled after internal validation.</p>
          {/if}
          {#if essayError}
            <p class="error">{essayError}</p>
          {/if}

          {#if essayFeedback}
            <section class="feedback-block">
              <h3>Your Dialectical Feedback</h3>
              <p class="meta">Domain: {essayFeedback.domain} · Score: {essayFeedback.summary_score} / 100 · Version {essayVersionNumber}</p>

              <details open>
                <summary>Analysis</summary>
                <p>{essayFeedback.pass_feedback.analysis}</p>
              </details>

              <details open>
                <summary>Critique</summary>
                <p>{essayFeedback.pass_feedback.critique}</p>
              </details>

              <details open>
                <summary>Synthesis</summary>
                <p>{essayFeedback.pass_feedback.synthesis}</p>
                <p><strong>Suggestions:</strong> {essayFeedback.synthesis_suggestions}</p>
              </details>

              <p><strong>Score rationale:</strong> {essayFeedback.score_rationale}</p>
              <p><strong>Recommended lessons:</strong> {essayFeedback.recommended_lessons.join(', ')}</p>

              <label>
                Revise and Re-review ->
                <textarea rows="10" bind:value={revisedText} disabled={SUBMIT_ESSAYS_COMING_SOON}></textarea>
              </label>
              <p class="meta">Revision word count: {revisedWordCount}</p>
              <button class="action secondary" disabled={revising || SUBMIT_ESSAYS_COMING_SOON} onclick={applySuggestions}>Apply Suggestions</button>
              {#if reviseError}
                <p class="error">{reviseError}</p>
              {/if}
            </section>
          {/if}
        {:else}
          <p>Select a preparation lesson first.</p>
        {/if}
      </section>
    </section>
  {/if}

  {#if activeSection === 'progress'}
    <section class="progress-box">
      <h2>Track how your thinking evolves through analysis, critique, and synthesis.</h2>
      {#if progressLoading}
        <p>Loading progress...</p>
      {:else if progressError}
        <p class="error">{progressError}</p>
      {:else}
        <p><strong>Completed units:</strong> {progressCompletedUnits.length}</p>
        <p><strong>Essays reviewed:</strong> {progressEssayCount}</p>
        <p><strong>Trajectory delta:</strong> {progressTrajectory >= 0 ? '+' : ''}{progressTrajectory}</p>

        {#if progressSkills}
          <div class="skill-bars">
            {#each Object.entries(progressSkills) as [label, value]}
              <div class="skill-row">
                <span>{label.replace('_', ' ')}</span>
                <div class="bar"><div class="fill" style={`width:${Math.max(0, Math.min(100, value))}%`}></div></div>
                <span>{value}</span>
              </div>
            {/each}
          </div>
        {/if}

        <p class="recommendation">{progressRecommendation}</p>
      {/if}
    </section>
  {/if}
</main>

<style>
  .learn-page {
    min-height: calc(100vh - var(--nav-height));
    padding: 20px;
    max-width: 1200px;
    margin: 0 auto;
    color: var(--color-text);
  }

  .hero {
    border: 1px solid var(--color-border);
    background: linear-gradient(130deg, rgba(127, 163, 131, 0.2), rgba(44, 96, 142, 0.14));
    border-radius: 12px;
    padding: 20px;
  }

  .hero h1 {
    margin: 8px 0;
    font-family: var(--font-display);
    font-size: clamp(1.6rem, 3vw, 2.4rem);
  }

  .eyebrow {
    font-size: 0.72rem;
    font-family: var(--font-ui);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--color-sage);
    margin: 0;
  }

  .subnav {
    margin-top: 16px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .journey {
    margin-top: 14px;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 14px;
    background: var(--color-surface);
    display: grid;
    gap: 10px;
  }

  .journey-header h2 {
    margin: 0 0 4px;
    font-family: var(--font-display);
    font-size: 1.15rem;
    color: var(--color-text);
  }

  .journey-header p {
    margin: 0;
    color: var(--color-muted);
    font-size: 0.86rem;
  }

  .journey-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 8px;
  }

  .journey-stage {
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 10px;
    background: var(--color-surface-raised);
  }

  .journey-stage.is-current {
    border-color: var(--color-sage);
    background: rgba(127, 163, 131, 0.12);
  }

  .journey-stage.is-complete {
    border-color: var(--color-blue);
  }

  .journey-stage h3 {
    margin: 4px 0;
    color: var(--color-text);
    font-size: 0.96rem;
  }

  .journey-stage p {
    margin: 0;
    color: var(--color-muted);
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .journey-step {
    color: var(--color-blue);
    font-family: var(--font-ui);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .journey-preview {
    margin-top: 8px;
    border-top: 1px solid var(--color-border);
    padding-top: 8px;
  }

  .journey-preview-label {
    color: var(--color-sage) !important;
    font-family: var(--font-ui);
    font-size: 0.68rem !important;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 4px !important;
  }

  .journey-preview ul {
    margin: 0;
    padding-left: 16px;
  }

  .journey-preview li {
    color: var(--color-text);
    font-size: 0.78rem;
    line-height: 1.35;
    margin: 2px 0;
  }

  .entitlement-banner {
    margin-top: 10px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 10px 12px;
    background: var(--color-surface);
    display: grid;
    gap: 8px;
  }

  .coming-soon-banner {
    border: 1px dashed var(--color-copper);
    background: color-mix(in srgb, var(--color-copper) 10%, var(--color-surface));
    border-radius: 10px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }

  .coming-soon-banner h3 {
    margin: 0 0 6px;
    color: var(--color-text);
    font-size: 1rem;
  }

  .coming-soon-banner p {
    margin: 0;
    color: var(--color-muted);
    font-size: 0.84rem;
    line-height: 1.45;
  }

  .subnav-btn {
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-muted);
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
  }

  .subnav-btn.is-active {
    background: var(--color-surface-raised);
    color: var(--color-text);
    border-color: var(--color-sage);
  }

  .split {
    margin-top: 14px;
    display: grid;
    grid-template-columns: minmax(280px, 360px) 1fr;
    gap: 12px;
  }

  .cards {
    display: grid;
    gap: 8px;
    align-content: start;
  }

  .difficulty-group {
    display: grid;
    gap: 8px;
    padding: 4px 0;
  }

  .difficulty-heading {
    margin: 0;
    padding: 0 2px;
    color: var(--color-sage);
    font-family: var(--font-ui);
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .lesson-card {
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: 10px;
    padding: 12px;
    text-align: left;
    cursor: pointer;
    color: var(--color-text);
  }

  .lesson-card.is-selected {
    border-color: var(--color-sage);
    background: var(--color-surface-raised);
  }

  .lesson-card h2 {
    margin: 0 0 7px;
    font-size: 1rem;
    font-family: var(--font-display);
    color: var(--color-text);
  }

  .lesson-card p {
    margin: 0;
    color: var(--color-muted);
    font-size: 0.82rem;
  }

  .card-kicker {
    margin-bottom: 4px;
    color: var(--color-blue);
    font-family: var(--font-ui);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .card-meta {
    color: var(--color-muted);
  }

  .lesson-card.is-locked {
    border-color: var(--color-copper);
  }

  .lesson-detail,
  .practice-box,
  .essay-box,
  .progress-box {
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: 12px;
    padding: 16px;
  }

  .markdown {
    color: var(--color-muted);
    line-height: 1.65;
  }

  .markdown :global(p) {
    margin: 0.55rem 0;
  }

  .markdown :global(ol),
  .markdown :global(ul) {
    margin: 0.6rem 0;
    padding-left: 1.35rem;
    list-style-position: outside;
  }

  .markdown :global(ol) {
    list-style-type: decimal;
  }

  .markdown :global(ul) {
    list-style-type: disc;
  }

  .markdown :global(li) {
    margin: 0.3rem 0;
    padding-left: 0.2rem;
    line-height: 1.55;
  }

  .markdown :global(li)::marker {
    color: var(--color-dim);
  }

  .lesson-detail h2,
  .lesson-detail h3,
  .practice-box h2,
  .practice-box h3,
  .essay-box h2,
  .essay-box h3,
  .progress-box h2 {
    color: var(--color-text);
  }

  .daily-drill-flow,
  .practice-drill-flow {
    margin-top: 12px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 10px;
    background: var(--color-surface-raised);
  }

  .daily-essentials,
  .practice-essentials {
    margin-top: 12px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 10px;
    background: var(--color-surface-raised);
  }

  .primer-preview {
    margin: 10px 0;
    color: var(--color-muted);
    line-height: 1.55;
    font-size: 0.92rem;
  }

  .expandable {
    margin-top: 8px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 8px 10px;
    background: var(--color-surface);
  }

  .expandable > summary {
    cursor: pointer;
    color: var(--color-text);
    font-size: 0.84rem;
    font-weight: 600;
  }

  .expandable > div {
    margin-top: 10px;
  }

  .supplemental {
    margin-top: 12px;
  }

  .flow-steps {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-top: 8px;
  }

  .flow-step {
    margin: 0;
    border: 1px dashed var(--color-border);
    border-radius: 8px;
    padding: 8px;
    font-size: 0.78rem;
    color: var(--color-muted);
    background: var(--color-surface);
  }

  .flow-step.is-complete {
    border-style: solid;
    border-color: var(--color-sage);
    color: var(--color-text);
  }

  .quiz-box,
  .daily-sprint {
    margin-top: 12px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 10px;
    background: var(--color-surface-raised);
  }

  .drill-locked {
    border-style: dashed;
    opacity: 0.82;
  }

  .quiz-item {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 8px;
    margin: 8px 0;
  }

  .quiz-item legend {
    color: var(--color-text);
    font-size: 0.85rem;
    padding: 0 4px;
  }

  .quiz-options {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .option-pill {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-surface);
    color: var(--color-muted);
    padding: 5px 10px;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .option-pill.is-selected {
    border-color: var(--color-blue);
    color: var(--color-text);
    background: rgba(44, 96, 142, 0.22);
  }

  .quiz-ok {
    color: var(--color-sage);
    font-size: 0.78rem;
  }

  .quiz-miss {
    color: var(--color-coral);
    font-size: 0.78rem;
  }

  .prompt-display {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 10px;
    background: var(--color-surface);
    margin-top: 10px;
  }

  .prompt-label {
    margin: 0 0 5px;
    color: var(--color-sage);
    font-family: var(--font-ui);
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }

  .prompt-display p {
    margin: 0;
    color: var(--color-text);
    line-height: 1.5;
    font-size: 0.9rem;
  }

  .objective-list {
    margin: 8px 0 12px;
    padding-left: 18px;
    color: var(--color-muted);
  }

  .examples,
  .refs,
  .guided {
    margin-top: 12px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 10px;
    background: var(--color-surface-raised);
  }

  .examples h3,
  .refs h3,
  .guided h3 {
    margin: 0 0 8px;
    font-family: var(--font-display);
    font-size: 1rem;
  }

  .example-card {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 8px;
    margin-bottom: 8px;
  }

  .refs ul {
    margin: 0;
    padding-left: 18px;
    color: var(--color-muted);
  }

  .refs li {
    margin-bottom: 6px;
  }

  .refs a {
    margin-left: 8px;
    color: var(--color-blue);
    text-decoration: none;
  }

  .ready-check {
    margin-top: 12px;
    border: 1px dashed var(--color-border);
    border-radius: 8px;
    padding: 8px 10px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 0.84rem;
  }

  .badge {
    margin-left: 6px;
    border-radius: 999px;
    padding: 1px 6px;
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .badge.ok {
    background: rgba(127, 163, 131, 0.2);
    color: var(--color-sage);
  }

  .badge.locked {
    background: rgba(183, 121, 74, 0.2);
    color: var(--color-copper);
  }

  label {
    display: grid;
    gap: 6px;
    margin-top: 10px;
    font-size: 0.86rem;
    color: var(--color-muted);
  }

  textarea {
    width: 100%;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 10px;
    color: var(--color-text);
    font-family: var(--font-ui);
    resize: vertical;
  }

  .action {
    margin-top: 12px;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 9px 14px;
    background: var(--color-sage);
    color: var(--color-bg);
    cursor: pointer;
  }

  .action.secondary {
    background: var(--color-blue);
    color: #fff;
  }

  .feedback, .feedback-block {
    margin-top: 14px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 12px;
    background: var(--color-surface-raised);
  }

  details {
    margin: 8px 0;
  }

  summary {
    cursor: pointer;
    color: var(--color-text);
    font-weight: 600;
  }

  .meta {
    color: var(--color-dim);
    font-size: 0.82rem;
  }

  .error {
    color: var(--color-coral);
  }

  .skill-bars {
    margin-top: 10px;
    display: grid;
    gap: 8px;
  }

  .skill-row {
    display: grid;
    grid-template-columns: 120px 1fr 40px;
    gap: 8px;
    align-items: center;
    font-size: 0.86rem;
  }

  .bar {
    height: 10px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: linear-gradient(90deg, var(--color-sage), var(--color-blue));
  }

  .recommendation {
    margin-top: 12px;
    border-left: 2px solid var(--color-sage);
    padding-left: 10px;
    color: var(--color-muted);
  }

  @media (max-width: 900px) {
    .split {
      grid-template-columns: 1fr;
    }

    .flow-steps {
      grid-template-columns: 1fr;
    }
  }
</style>
