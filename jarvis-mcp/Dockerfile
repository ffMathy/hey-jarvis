# Build stage - runs mastra build with full monorepo context
FROM docker.io/node:lts-alpine AS builder

# Install dependencies required for native modules and Mastra CLI
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite-libs \
    sqlite-dev \
    libc6-compat

WORKDIR /workspace

# Copy package files for dependency installation
COPY package.json package-lock.json* ./
COPY jarvis-mcp/package.json ./jarvis-mcp/

# Install all dependencies (including NX workspace dependencies)
RUN npm install

# Install Mastra CLI globally
RUN npm install -g mastra

# Copy necessary files for Mastra build
COPY nx.json tsconfig.base.json ./
COPY jarvis-mcp/ ./jarvis-mcp/

# Run mastra build - this will build for the Alpine Linux architecture
RUN mastra build --dir jarvis-mcp/mastra --root .

# Production stage - minimal image with only the built application
FROM docker.io/node:lts-alpine

# Install dependencies required for native modules (libsql)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite-libs \
    sqlite-dev

ENV HOST=0.0.0.0
ENV PORT=4111

WORKDIR /app

# Copy the built Mastra application from builder stage
COPY --from=builder /workspace/.mastra/output ./

# Expose the port for Mastra server
EXPOSE 4111

# Run the built Mastra application
CMD [ "node", "./index.mjs" ]
