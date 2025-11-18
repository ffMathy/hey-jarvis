# Build stage - use Bun image for building
FROM docker.io/oven/bun:1-alpine AS builder

WORKDIR /workspace

# Copy package files for dependency installation
COPY package.json bun.lock ./
COPY mcp/package.json ./mcp/

# Install all dependencies (needed for TypeScript compilation)
RUN bun install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY mcp/ ./mcp/

# Production stage - use Bun Alpine for minimal size
FROM docker.io/oven/bun:1-alpine AS production

ENV HOST=0.0.0.0
ENV NODE_ENV=production

WORKDIR /workspace

# Install bash (required for run.sh script)
RUN apk add --no-cache bash

# Copy package files
COPY package.json bun.lock ./
COPY mcp/package.json ./mcp/

# Install only production dependencies and global tools
RUN bun install --frozen-lockfile --production && \
    bun add -g tsx@4.20.6 mastra@1.0.0-beta.1

# Copy source code from builder
COPY --from=builder /workspace/tsconfig.base.json ./
COPY --from=builder /workspace/mcp/ ./mcp/

# Expose ports for both services
EXPOSE 4111 4112

# Make run script executable
RUN chmod a+x ./mcp/run.sh

# Override the base image's entrypoint and use the run script
# The node:lts-alpine base image has docker-entrypoint.sh which expects node commands,
# so we need to explicitly set our own entrypoint
ENTRYPOINT [ "./mcp/run.sh" ]
