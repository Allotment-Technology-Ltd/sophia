# Source Texts

This directory contains raw philosophical source texts used for ingestion into
SOPHIA's argument graph. These files are **not committed** to the repository because
they include copyrighted material (Stanford Encyclopedia of Philosophy entries,
academic papers, book excerpts, etc.).

## Reproducing the Knowledge Base

To re-ingest the Phase 3a ethics corpus:

1. **Fetch sources** listed in `data/source-list-3a.json`:
   ```bash
   pnpm tsx scripts/fetch-source.ts <url> <source_type>
   ```

2. **Ingest each source** into the argument graph:
   ```bash
   pnpm tsx scripts/ingest.ts <source-file> --validate
   ```

3. **Verify integrity**:
   ```bash
   pnpm tsx scripts/verify-db.ts
   ```

## Phase 3a Sources (29 sources planned, Wave 1 complete)

See `data/source-list-3a.json` for the full annotated list covering:

- **Normative ethics**: Utilitarianism, Deontological Ethics, Virtue Ethics
- **Applied ethics**: Singer's Famine/Affluence/Morality, EU AI Act analysis
- **Meta-ethics**: Moral Realism, Expressivism, Error Theory

Wave 1 sources (SEP entries + foundational texts) are fully ingested.
Waves 2–3 cover consequentialism, Kantian ethics, rights theory, and bioethics.

## Copyright Notice

The source texts are the intellectual property of their respective authors and
publishers. Redistribution is not permitted. SOPHIA uses these texts solely for
research purposes under fair use / fair dealing principles.
