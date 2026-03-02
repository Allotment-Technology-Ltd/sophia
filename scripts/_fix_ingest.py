#!/usr/bin/env python3
"""Fix the broken try/catch structure in ingest.ts around the per-section checkpoint code."""

import re

with open('scripts/ingest.ts', 'r') as f:
    content = f.read()

# Verify current broken state
if content.count('const offset = allClaims.length;') < 2:
    print("ERROR: Expected 2 occurrences of 'const offset = allClaims.length;' but found fewer. File may already be fixed or has different content.")
    import sys; sys.exit(1)

# We'll use line-based surgery. Find lines 868-934 range and replace.
lines = content.split('\n')

# Find the start line: the try { just after logClaudeCost('Extraction'); in the large-source for-loop
# We look for the try that's followed by parseJsonResponse(rawResponse) within a few lines,
# which is inside the for loop (not the outer try for callClaudeWithProgress)
start_idx = None
end_idx = None

for i, line in enumerate(lines):
    # Find the try { that contains our broken code block
    # It should be around line 868 (0-indexed: 867)
    if i > 830 and i < 900 and line.strip() == 'try {':
        # Look ahead to confirm this is the JSON parse try
        for j in range(i+1, min(i+5, len(lines))):
            if 'parseJsonResponse(rawResponse)' in lines[j]:
                start_idx = i
                break
    if start_idx is not None:
        break

if start_idx is None:
    print("ERROR: Could not find start of broken try block")
    import sys; sys.exit(1)

print(f"Found broken try block at line {start_idx + 1}")

# Now find the end: the '} else {' that starts the normal-source branch
# It should be 2 tabs deep (same level as the if (isLargeSource))
for i in range(start_idx + 1, min(start_idx + 80, len(lines))):
    stripped = lines[i].strip()
    if stripped == '} else {':
        end_idx = i
        break

if end_idx is None:
    print("ERROR: Could not find '} else {' end marker")
    import sys; sys.exit(1)

print(f"Found '}} else {{' at line {end_idx + 1}")

# Get the indentation of the try { line to determine base indent
base_indent = len(lines[start_idx]) - len(lines[start_idx].lstrip())
indent = '\t' * (base_indent // 4) if '\t' in lines[start_idx] else ' ' * base_indent

# Actually let's just use the literal content from the line
# Measure tabs
tab_count = len(lines[start_idx]) - len(lines[start_idx].lstrip('\t'))
t = '\t' * tab_count  # this is the indent for the try { line itself

print(f"Base indent: {tab_count} tabs")

# Build the replacement block
replacement = [
    f'{t}try {{',
    f'{t}\tconst parsed = parseJsonResponse(rawResponse);',
    f'{t}\tconst validated = ExtractionOutputSchema.parse(parsed);',
    f'',
    f'{t}\t// Offset positions for later sections',
    f'{t}\tconst offset = allClaims.length;',
    f'{t}\tconst offsetClaims = validated.map((c) => ({{',
    f'{t}\t\t...c,',
    f'{t}\t\tposition_in_source: c.position_in_source + offset',
    f'{t}\t}}));',
    f'',
    f'{t}\tallClaims.push(...offsetClaims);',
    f'{t}\tconsole.log(`  [OK] Extracted ${{validated.length}} claims from section ${{sectionLabel}}`);',
    f'',
    f'{t}\t// Checkpoint after each successful section — resume here if process crashes',
    f'{t}\tpartial.extraction_progress = {{',
    f'{t}\t\tclaims_so_far: [...allClaims],',
    f'{t}\t\tremaining_sections: sectionQueue.slice(i + 1)',
    f'{t}\t}};',
    f'{t}\tsavePartialResults(slug, partial);',
    f'{t}}} catch (parseError) {{',
    f'{t}\tconsole.warn(`  [WARN] JSON parse/validation failed for section ${{sectionLabel}}. Attempting fix...`);',
    f'',
    f'{t}\tlet fixedResponse: string;',
    f'{t}\ttry {{',
    f'{t}\t\tfixedResponse = await fixJsonWithClaude(',
    f'{t}\t\t\tclaude,',
    f'{t}\t\t\trawResponse,',
    f'{t}\t\t\tparseError instanceof Error ? parseError.message : String(parseError),',
    f"{t}\t\t\t'Array of {{ text, claim_type, domain, section_context, position_in_source, confidence }}'",
    f'{t}\t\t);',
    f'{t}\t}} catch (fixError) {{',
    f'{t}\t\tconst fixMsg = fixError instanceof Error ? fixError.message : String(fixError);',
    f'{t}\t\tif (fixMsg.includes(\'truncated (max_tokens reached)\') && section.length > 500) {{',
    f'{t}\t\t\tconst mid = Math.floor(section.length / 2);',
    f'{t}\t\t\tconsole.warn(',
    f'{t}\t\t\t\t`  [SPLIT] Section ${{sectionLabel}} fix response truncated — splitting into 2 sub-sections and retrying`',
    f'{t}\t\t\t);',
    f'{t}\t\t\tsectionQueue.splice(i + 1, 0, section.substring(0, mid), section.substring(mid));',
    f'{t}\t\t\tsectionLabel--;',
    f'{t}\t\t\tcontinue;',
    f'{t}\t\t}}',
    f'{t}\t\tthrow fixError;',
    f'{t}\t}}',
    f'',
    f'{t}\tconst fixedParsed = parseJsonResponse(fixedResponse);',
    f'{t}\tconst fixedValidated = ExtractionOutputSchema.parse(fixedParsed);',
    f'{t}\tconst fixOffset = allClaims.length;',
    f'{t}\tconst fixOffsetClaims = fixedValidated.map((c) => ({{',
    f'{t}\t\t...c,',
    f'{t}\t\tposition_in_source: c.position_in_source + fixOffset',
    f'{t}\t}}));',
    f'{t}\tallClaims.push(...fixOffsetClaims);',
    f'{t}\tconsole.log(`  [OK] Fixed and extracted ${{fixedValidated.length}} claims from section ${{sectionLabel}}`);',
    f'',
    f'{t}\t// Checkpoint after each successful section (even after fix) — resume here if process crashes',
    f'{t}\tpartial.extraction_progress = {{',
    f'{t}\t\tclaims_so_far: [...allClaims],',
    f'{t}\t\tremaining_sections: sectionQueue.slice(i + 1)',
    f'{t}\t}};',
    f'{t}\tsavePartialResults(slug, partial);',
    f'{t}}}',
    f'{"\t" * (tab_count - 1)}}}',
]

# Replace lines start_idx..end_idx-1 with our replacement
# Keep end_idx line (}) else {) and everything after
new_lines = lines[:start_idx] + replacement + lines[end_idx:]

new_content = '\n'.join(new_lines)

# Verify fix: should now have only 1 'const offset = allClaims.length'
count = new_content.count('const offset = allClaims.length;')
fix_count = new_content.count('const fixOffset = allClaims.length;')
print(f"After fix: 'const offset = ...' count = {count} (should be 1)")
print(f"After fix: 'const fixOffset = ...' count = {fix_count} (should be 1)")

if count == 1 and fix_count == 1:
    with open('scripts/ingest.ts', 'w') as f:
        f.write(new_content)
    print("SUCCESS: File written")
else:
    print("ERROR: Counts wrong, not writing file")
