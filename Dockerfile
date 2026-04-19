# Stage 1: Builder
FROM node:22 AS builder

WORKDIR /app

ARG VITE_NEON_AUTH_URL

ENV VITE_NEON_AUTH_URL=${VITE_NEON_AUTH_URL}

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency files, workspace config, and local tarball packages used by pnpm
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY packages ./packages
# Keep a vendor directory even when the repo has no vendored artifacts.
RUN mkdir -p vendor

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# `vite build` / SvelteKit postbuild analyse import server chunks that load `sophiaDocumentsDb.ts`,
# which requires `DATABASE_URL` when `SOPHIA_DATA_BACKEND=neon`. Runtime gets the real URL from
# Cloud Run secrets; the builder only needs a syntactically valid placeholder (no connection).
ENV DATABASE_URL=postgresql://sveltekit_build_placeholder@127.0.0.1:5432/postgres?sslmode=disable

# Build the app
RUN pnpm build

# Stage 2: Runtime
FROM node:22

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files, workspace config, and local tarball packages used by pnpm
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY packages ./packages
# Keep a vendor directory even when the repo has no vendored artifacts.
RUN mkdir -p vendor

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built app from builder
COPY --from=builder /app/build ./build

# Ingestion adapter runs `npx tsx scripts/fetch-source.ts` / `scripts/ingest.ts` — needs sources + config for ESM resolution
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
# Minimal tsconfig (fetch-source + sourceIdentity) for tsx; full app typecheck still uses jsconfig.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/jsconfig.json ./jsconfig.json

# Fail the image build if prod node_modules cannot resolve the ingest.ts import graph
RUN npx tsx scripts/verify-cloud-run-ingest-modules.ts

# Writable cache for fetched sources (Cloud Run: ensure no read-only root override)
RUN mkdir -p data/sources
# Repo-tracked sources (often empty except README); batch jobs that reference slugs without a fresh fetch need files present
COPY --from=builder /app/data/sources ./data/sources
# Admin SEP batch picker reads catalog + topic presets at runtime (see sepEntryBatchPick.ts)
COPY --from=builder /app/data/sep-entry-urls.json ./data/sep-entry-urls.json
COPY --from=builder /app/data/sep-topic-presets.json ./data/sep-topic-presets.json

# Set the port
ENV PORT=8080

EXPOSE 8080

CMD ["node", "build"]
