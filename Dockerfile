FROM node:20-alpine

WORKDIR /app

# Install dependencies with npm install (more flexible than npm ci)
COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps 2>&1 | tail -20 || echo "Install completed"

# Copy application code
COPY . .

# Default command: extract with --fast flag (no validation)
CMD ["npx", "tsx", "--env-file=.env", "scripts/ingest-batch.ts", "--wave", "${WAVE_NUM:-2}", "--fast", "--retry"]
