#!/bin/bash
# SOPHIA Documentation Update Checklist
# Run this after completing a major milestone, feature, or bug fix
# Usage: Copy the checklist below, fill in your milestone, then mark items as you go
#
# Example:
#   Milestone: "Complete Phase 3c Firebase Auth integration"
#   [ ] Update ROADMAP.md
#   [x] Update STATUS.md
#   [ ] Update CHANGELOG.md
#   ...

echo "SOPHIA Documentation Update Checklist"
echo "====================================="
echo ""
echo "Fill in your milestone:"
read -p "Milestone: " MILESTONE
echo ""
echo "After completing this milestone, ensure:"
echo ""
echo "[ ] ROADMAP.md updated"
echo "    - Mark completed tasks as [x]"
echo "    - Update 'Progress' percentage"
echo "    - Update 'Remaining tasks' list"
echo "    - Verify 'Current Status' section is accurate"
echo ""
echo "[ ] STATUS.md updated"
echo "    - Update 'Last updated' date"
echo "    - Update 'Summary' description"
echo "    - Check CI/CD, Deployments & infra sections"
echo ""
echo "[ ] CHANGELOG.md updated"
echo "    - Add new [Milestone-date] header at top"
echo "    - List what was completed, what changed"
echo "    - Link to any related docs"
echo ""
echo "[ ] Architecture doc(s) updated (if schema/design changed)"
echo "    - docs/architecture.md"
echo "    - docs/argument-graph.md (if schema changed)"
echo "    - docs/prompts-reference.md (if prompts changed)"
echo ""
echo "[ ] If phase completed:"
echo "    - Move old phase checklists to docs/archive/"
echo "    - Create docs/archive/README.md entry"
echo "    - Link old docs from archive README"
echo ""
echo "[ ] Run documentation review:"
echo "    ./scripts/review-docs.sh --strict"
echo ""
echo "[ ] Commit all doc updates with your code:"
echo "    git add ROADMAP.md STATUS.md CHANGELOG.md docs/"
echo "    git commit -m 'docs: $MILESTONE'"
echo ""
echo "[ ] (Optional) Add related docs to GitHub PR description"
echo ""
echo "====================================="
echo "When all items are complete, run:"
echo "  git log --oneline -1"
echo "to verify your commit."
