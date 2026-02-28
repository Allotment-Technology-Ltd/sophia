# Stage 1: Builder
FROM node:20 AS builder

WORKDIR /app

# Copy dependency and config files
COPY package.json package-lock.json .npmrc ./

# Install dependencies with increased timeout
RUN npm install --prefer-offline --no-audit

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Stage 2: Runtime
FROM node:20

WORKDIR /app

# Copy package files and config
COPY package.json package-lock.json .npmrc ./

# Install production dependencies only
RUN npm install --omit=dev --prefer-offline --no-audit

# Copy built app from builder
COPY --from=builder /app/build ./build

# Set the port
ENV PORT=8080

EXPOSE 8080

CMD ["node", "build"]
