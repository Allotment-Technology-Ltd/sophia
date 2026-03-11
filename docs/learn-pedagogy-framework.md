# SOPHIA Learn Pedagogy Framework

Last updated: 2026-03-11

## Scope
Define the non-negotiable pedagogy for SOPHIA Learn so every lesson, prompt, and feedback loop follows a coherent teaching model instead of ad-hoc task prompting.

## UCL Guide Audit (All Pages Reviewed)
Reviewed pages from the UCL Education (Theory and Practice) guide family:
- https://library-guides.ucl.ac.uk/Education_theory_practice/welcome
- https://library-guides.ucl.ac.uk/Education_theory_practice/books
- https://library-guides.ucl.ac.uk/Education_theory_practice/journals
- https://library-guides.ucl.ac.uk/Education_theory_practice/databases
- https://library-guides.ucl.ac.uk/Education_theory_practice/literature-searching
- https://library-guides.ucl.ac.uk/Education_theory_practice/referencing
- https://library-guides.ucl.ac.uk/Education_theory_practice/help
- https://library-guides.ucl.ac.uk/Education_theory_practice/systematic_reviews
- https://library-guides.ucl.ac.uk/Education_theory_practice/official-publications
- https://library-guides.ucl.ac.uk/Education_theory_practice/special-collections
- https://library-guides.ucl.ac.uk/Education_theory_practice/other-libraries
- https://library-guides.ucl.ac.uk/Education_theory_practice/other-resources
- https://library-guides.ucl.ac.uk/Education_theory_practice/youth-studies
- https://library-guides.ucl.ac.uk/Education_theory_practice/IOE_Library_displays

Note: `Other_resources` resolves to `other-resources`; content is represented above.

## What the Guide Implies for SOPHIA
1. Resource-rich learning, not prompt-only practice
- UCL emphasizes curated books/journals/databases and support pathways.
- SOPHIA must always provide preparatory content and reading routes before assessed writing.

2. Information literacy as core reasoning skill
- Literature-searching, systematic reviews, and referencing are central, not optional extras.
- SOPHIA lessons must train evidence discovery, source evaluation, and citation discipline.

3. Iterative inquiry model
- Systematic review guidance stresses iterative scoping, search refinement, appraisal, and synthesis.
- SOPHIA should treat argument construction as iterative drafts with explicit revision cycles.

4. Human support and gradual autonomy
- Help/training pages foreground scaffolding and consultation.
- SOPHIA should move from high-support drills to independent essays with adaptive support.

5. Domain/context sensitivity
- Official publications, special collections, and youth studies demonstrate domain-specific evidence ecologies.
- SOPHIA should contextualize philosopher examples and reading tasks by domain and difficulty.

## Fundamental Pedagogy Contract
1. Lesson-before-task rule
- No short review or essay task without a primer lesson, examples, and references.

2. Progressive sequence
- Learn loop: Concept primer -> retrieval check -> guided response -> dialectical feedback -> reflection -> revision.

3. Formative feedback rule
- Every feedback cycle must include:
- analysis (what the learner did),
- critique (where reasoning fails),
- synthesis (how to improve next draft),
- one explicit next-step action.

4. Evidence and attribution rule
- Every lesson example must include citation metadata or source URL.
- Every lesson must include at least two references.

5. Cognitive load rule
- Difficulty 3+ lessons require guided reading chunks that break complex texts into manageable segments.

## v1/v2 Product Requirements
### Required in content model
- `objectives`: 2-4 per lesson.
- `examples`: at least one referenced example.
- `references`: at least two items.
- `guided_reading`: required for difficulty 3+.
- `quiz`: required for daily drills (retrieval check).

### Required in tutoring behavior
- Keep critique bounded and actionable.
- Preserve learner intent during synthesis.
- Recommend specific next lessons or tasks.
- Use low-jargon, scholarly tone.

### Required in progression
- Track completion + versioned drafts.
- Trigger remediation paths when weak dimensions persist.
- Prioritize weak dimensions in `My Progress` recommendations.

## Implementation Status
Implemented in code:
- Added lesson pedagogy validator (`src/lib/server/learn/pedagogy.ts`) and wired validation into lesson loading.
- Updated content loader to reuse canonical lesson schemas so example references/citations are preserved.
- Tightened teaching prompts with pedagogy guardrails across breakdown/analysis/critique/synthesis/short-review/progress prompts.
- Added missing guided reading in `logic_intro_05` to satisfy higher-difficulty scaffolding.

## Acceptance Criteria
1. No lesson loads if it violates pedagogy contract constraints.
2. Learners always receive preparatory material before assessed writing.
3. Feedback remains three-pass and explicitly formative.
4. Higher-difficulty lessons always include guided reading chunks.
5. Referenced examples and reading lists are present across curriculum.
