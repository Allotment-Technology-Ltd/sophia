# Fix Resume Functionality in scripts/ingest.ts

## Current Status

The ingestion script `scripts/ingest.ts` has **partial resume functionality implemented** but contains **syntax errors preventing compilation**.

### Compilation Errors
```
scripts/ingest.ts(1231,4): error TS1005: 'try' expected.
scripts/ingest.ts(1242,1): error TS1005: '}' expected.
```

### Brace Mismatch Analysis
Run `node scripts/brace-check.cjs` to see detailed analysis:
```
Total lines: 1242
Try block brace balance (497-1230): +194 -190 = 4
Stage1-extraction (497-617): +36 -34 = 2    ← EXTRA 2 braces
Stage2-relations (617-680): +15 -14 = 1     ← EXTRA 1 brace
Stage3-grouping (680-727): +13 -14 = -1     ← MISSING 1 brace
Stage4-embedding (727-806): +26 -25 = 1     ← EXTRA 1 brace
Stage5-validation (806-917): +29 -28 = 1    ← EXTRA 1 brace
Stage6-storage (917-1230): +75 -75 = 0      ← BALANCED
```

**Total imbalance: +3 braces** (should be 0 for proper try/catch)

## Resume Functionality Architecture

### Current Implementation
The script has `loadPartialResults()` and `savePartialResults()` functions that save progress to:
```
data/ingested/{slug}-partial.json
```

Partial results structure:
```typescript
{
  source: string,
  claims?: ExtractionOutput,
  relations?: RelationsOutput,
  arguments?: GroupingOutput,
  embeddings?: number[][],
  validation?: ValidationOutput,
  stage_completed?: 'extraction' | 'relations' | 'grouping' | 'embedding' | 'validation' | 'stored'
}
```

### Resume Logic Locations
- **Stage 1 (Extraction)**: Lines 503-516 - ✅ WORKING
- **Stage 2 (Relations)**: Lines 621-633 - ⚠️ Has resume check, but indentation issues
- **Stage 3 (Grouping)**: Lines 678-687 - ⚠️ Has resume check, but indentation issues
- **Stage 4 (Embedding)**: Lines 731-742 - ⚠️ Has resume check, but indentation issues
- **Stage 5 (Validation)**: Lines 812-821 - ⚠️ Has resume check, but indentation issues

### Key Indentation Issues

**Problem Pattern**: In stages 2-4, the first statement after `} else {` has 4 tabs instead of 3:
```typescript
} else {
    console.log(...);  // Should be 3 tabs

    const someVar = ...;  // This line has 4 tabs - WRONG!
```

**Stage 2 (line 636-638)**: `const relUserMsg` has 4 tabs instead of 3
**Stage 3 (line 695-697)**: `const grpUserMsg` has 4 tabs instead of 3
**Stage 4 (line 750-752)**: Loop body content has 3 tabs but should be 4 (for loop is at 3)

## Task Requirements

1. **Fix all brace/indentation issues** to make the file compile
2. **Preserve all resume functionality** that's already implemented
3. **Test that basic ingestion works**: `npx tsx --env-file=.env scripts/ingest.ts data/sources/test-file.txt`
4. **Test resume works**: Interrupt ingestion mid-way, then run with `--resume` flag

## Approach

### Option 1: Surgical Fixes (Recommended)
1. Fix Stage 1: Remove 2 extra closing braces (likely at line 616 area)
2. Fix Stage 2: Fix indentation of line 636 (remove 1 tab), remove 1 extra brace
3. Fix Stage 3: Fix indentation of line 695 (remove 1 tab), add 1 missing brace
4. Fix Stage 4: Fix loop body indentation, remove 1 extra brace
5. Fix Stage 5: Remove 1 extra brace
6. Verify compilation: `npx tsc --noEmit scripts/ingest.ts`

### Option 2: Reference Working Version
Check `scripts/ingest.ts.failed` (saved before resume additions) - it had 4 errors at:
- Line 916: Missing closing brace for validation else block
- Lines 1239, 1249, 1250: Try/catch structure issues

The current file is based on that state with resume logic added.

## Key Lines to Review

- **Line 516**: End of Stage 1 resume check
- **Line 517**: Should start Stage 1 normal execution
- **Line 600**: End of Stage 1 execution
- **Line 616**: Extra closing brace here?
- **Line 636**: Wrong indentation (4 tabs → 3 tabs)
- **Line 677**: End of Stage 2
- **Line 695**: Wrong indentation (4 tabs → 3 tabs)
- **Line 728**: End of Stage 3
- **Line 750**: For loop body indentation issue
- **Line 804**: End of Stage 4
- **Line 820**: Start of validation else block
- **Line 911**: End of validation block (was line 916 in .failed version)

## Testing Commands

```bash
# Check compilation
npx tsc --noEmit scripts/ingest.ts

# Check brace balance
node scripts/brace-check.cjs

# Test basic ingestion (no resume)
npx tsx --env-file=.env scripts/ingest.ts data/sources/the-history-of-utilitarianism.txt

# Test with validation
npx tsx --env-file=.env scripts/ingest.ts data/sources/the-history-of-utilitarianism.txt --validate

# Test resume functionality
# (Interrupt with Ctrl+C after stage 2, then run with --resume)
npx tsx --env-file=.env scripts/ingest.ts data/sources/the-history-of-utilitarianism.txt --resume
```

## Database Info

- **SurrealDB**: Running in Docker (sophia-surrealdb-1)
- **Connection**: ws://localhost:8123/rpc
- **Namespace**: sophia
- **Database**: sophia
- **Credentials**: In `.env` file

Current database state (verified working):
- 5 sources
- 117 claims
- 29 arguments
- 39 supports, 14 contradicts, 6 depends_on, 4 responds_to, 17 refines, 15 exemplifies relations

## Files Modified Previously

- ✅ `src/lib/server/claude.ts` - Claude Sonnet 4.5 with fallbacks
- ✅ `src/lib/server/voyage.ts` - Voyage-4 (1024-dim) with fallbacks
- ✅ `src/lib/server/gemini.ts` - Gemini 2.0 Flash with fallbacks
- ✅ `scripts/fetch-source.ts` - Fixed SEP title/author extraction
- ✅ `scripts/verify-db.ts` - Database verification script
- ⚠️ `scripts/ingest.ts` - Has resume logic but syntax errors

## Expected Outcome

After fixes:
1. `npx tsc --noEmit scripts/ingest.ts` should show 0 errors
2. `node scripts/brace-check.cjs` should show balance = 0 for try block
3. Basic ingestion should complete successfully
4. Interrupting and resuming should work for all 5 stages

---

**Start by running `npx tsc --noEmit scripts/ingest.ts` to see current errors, then systematically fix the brace/indentation issues identified above.**
