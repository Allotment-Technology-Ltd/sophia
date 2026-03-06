#!/bin/bash
# SOPHIA Documentation Review Tool
# Runs documentation health checks and flags issues
# Usage: ./scripts/review-docs.sh [--fix] [--strict]

set -e

DOCS_DIR="docs"
ARCHIVE_DIR="$DOCS_DIR/archive"
STRICT=${1:-""}
FIX=false

# Colors
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "📚 SOPHIA Documentation Review"
echo "=============================="

# Track findings
ERRORS=0
WARNINGS=0
PASSED=0

# 1. Check that canonical docs exist at root or docs/
check_canonical_docs() {
  echo ""
  echo "✓ Checking canonical documents..."
  
  canonical_files=(
    "ROADMAP.md"
    "STATUS.md"
    "CHANGELOG.md"
    "docs/architecture.md"
  )
  
  for file in "${canonical_files[@]}"; do
    if [ -f "$file" ]; then
      PASSED=$((PASSED + 1))
      echo "  ✓ $file exists"
    else
      echo -e "  ${RED}✗ MISSING: $file${NC}"
      ERRORS=$((ERRORS + 1))
    fi
  done
}

# 2. Check for broken internal links
check_links() {
  echo ""
  echo "✓ Checking internal links..."
  
  # Find all markdown files
  while IFS= read -r file; do
    # Extract local links: [text](path.md)
    links=$(grep -oP '\]\([^)]+\.md\)' "$file" 2>/dev/null | sed 's/^\](\(.*\))$/\1/' | sort -u || true)
    
    if [ -z "$links" ]; then
      continue
    fi
    
    while IFS= read -r link; do
      # Remove anchor: docs/file.md#section → docs/file.md
      target=$(echo "$link" | cut -d'#' -f1)
      
      # Resolve relative path
      dir=$(dirname "$file")
      full_path=$(cd "$dir" && echo "$target" | xargs readlink -f 2>/dev/null || true)
      
      if [ -z "$full_path" ] || [ ! -e "$full_path" ]; then
        echo -e "  ${RED}✗ Broken link in $file: $link${NC}"
        ERRORS=$((ERRORS + 1))
      fi
    done <<< "$links"
  done < <(find "$DOCS_DIR" -name "*.md" -type f)
  
  if [ $ERRORS -eq 0 ]; then
    echo "  ✓ All links valid"
    PASSED=$((PASSED + 1))
  fi
}

# 3. Check ROADMAP is up-to-date (modified in last 2 weeks)
check_roadmap_freshness() {
  echo ""
  echo "✓ Checking ROADMAP.md recency..."
  
  if [ -f "ROADMAP.md" ]; then
    modified=$(stat -f %m "ROADMAP.md" 2>/dev/null || stat -c %Y "ROADMAP.md")
    now=$(date +%s)
    age_days=$(( (now - modified) / 86400 ))
    
    if [ $age_days -gt 14 ] && [ "$STRICT" = "--strict" ]; then
      echo -e "  ${YELLOW}⚠ ROADMAP.md last updated $age_days days ago${NC}"
      WARNINGS=$((WARNINGS + 1))
    elif [ $age_days -le 14 ]; then
      echo "  ✓ ROADMAP.md updated $age_days days ago"
      PASSED=$((PASSED + 1))
    fi
  fi
}

# 4. Check for stale archived docs (have README)
check_archive() {
  echo ""
  echo "✓ Checking archive directory..."
  
  if [ -d "$ARCHIVE_DIR" ]; then
    if [ -f "$ARCHIVE_DIR/README.md" ]; then
      echo "  ✓ Archive has README.md"
      PASSED=$((PASSED + 1))
    else
      echo -e "  ${YELLOW}⚠ Archive missing README.md${NC}"
      WARNINGS=$((WARNINGS + 1))
    fi
    
    count=$(find "$ARCHIVE_DIR" -name "*.md" -type f | wc -l)
    echo "  ℹ Archive contains $count documents"
  else
    echo -e "  ${YELLOW}⚠ No archive/ directory found${NC}"
    WARNINGS=$((WARNINGS + 1))
  fi
}

# 5. Check for TODO placeholders in docs (flag as warnings)
check_todos() {
  echo ""
  echo "✓ Checking for TODO placeholders..."
  
  if grep -r "TODO.*update\|FIXME" "$DOCS_DIR" 2>/dev/null | grep -v archive; then
    echo -e "  ${YELLOW}⚠ Found TODOs in docs (file an issue instead)${NC}"
    WARNINGS=$((WARNINGS + 1))
  else
    echo "  ✓ No TODO placeholders found"
    PASSED=$((PASSED + 1))
  fi
}

# 6. Check design tokens vs design system
check_design_tokens() {
  echo ""
  echo "✓ Checking design system consistency..."
  
  if [ -f "src/styles/design-tokens.css" ] && [ -f "$DOCS_DIR/design/sophia-design-system-B.md" ]; then
    # Simple check: count matching color tokens
    tokens_count=$(grep -c "^--color-" src/styles/design-tokens.css || true)
    echo "  ✓ Found $tokens_count design tokens"
    PASSED=$((PASSED + 1))
  fi
}

# 7. Check for docs outside docs/ (except root policy files)
check_stray_docs() {
  echo ""
  echo "✓ Checking for stray documentation files..."
  
  # Allowed at root
  allowed=("ROADMAP.md" "STATUS.md" "CHANGELOG.md" "README.md")
  
  stray=$(find . -maxdepth 1 -name "*.md" -type f ! -name "README.md" ! -name "ROADMAP.md" ! -name "STATUS.md" ! -name "CHANGELOG.md" 2>/dev/null || true)
  
  if [ -z "$stray" ]; then
    echo "  ✓ No stray docs at root"
    PASSED=$((PASSED + 1))
  else
    echo -e "  ${YELLOW}⚠ Found docs outside docs/ directory:${NC}"
    echo "$stray" | while read file; do
      echo "    → $file (should be in docs/)"
    done
    WARNINGS=$((WARNINGS + 1))
  fi
}

# Run all checks
check_canonical_docs
check_roadmap_freshness
check_archive
check_todos
check_design_tokens
check_stray_docs
check_links

# Summary
echo ""
echo "=============================="
echo -e "Results: ${GREEN}$PASSED passed${NC}, ${YELLOW}$WARNINGS warnings${NC}, ${RED}$ERRORS errors${NC}"

if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}❌ Documentation review failed${NC}"
  exit 1
elif [ $WARNINGS -gt 0 ] && [ "$STRICT" = "--strict" ]; then
  echo -e "${YELLOW}⚠ Documentation has warnings (strict mode)${NC}"
  exit 1
else
  echo -e "${GREEN}✅ Documentation review passed${NC}"
  exit 0
fi
