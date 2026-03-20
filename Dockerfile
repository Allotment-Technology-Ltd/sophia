# Stage 1: Builder
FROM node:22 AS builder

WORKDIR /app

ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID

ENV VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY}
ENV VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN}
ENV VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID}

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency files and local tarball packages used by pnpm file: deps
COPY package.json pnpm-lock.yaml ./
COPY vendor ./vendor

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the app
RUN pnpm build

# Stage 2: Runtime
FROM node:22

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files and local tarball packages used by pnpm file: deps
COPY package.json pnpm-lock.yaml ./
COPY vendor ./vendor

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built app from builder
COPY --from=builder /app/build ./build

# Ingestion adapter runs `npx tsx scripts/fetch-source.ts` / `scripts/ingest.ts` — needs sources + config for ESM resolution
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/jsconfig.json ./jsconfig.json

# Writable cache for fetched sources (Cloud Run: ensure no read-only root override)
RUN mkdir -p data/sources

# Set the port
ENV PORT=8080

EXPOSE 8080

CMD ["node", "build"]
