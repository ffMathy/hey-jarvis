# Build stage - use slim image for building
FROM docker.io/node:lts-slim AS builder

WORKDIR /workspace

# Copy package files for dependency installation
COPY package.json package-lock.json ./
COPY mcp/package.json ./mcp/

# Install all dependencies (needed for TypeScript compilation)
RUN npm ci --include=dev

# Copy source code
COPY tsconfig.base.json ./
COPY mcp/ ./mcp/

# Production stage - use Alpine for minimal size
# Using node:lts-alpine which has better multi-arch support including arm64
FROM docker.io/node:lts-alpine AS production

ENV HOST=0.0.0.0
ENV NODE_ENV=production

WORKDIR /workspace

# Install bash (required for run.sh script)
RUN apk add --no-cache bash

# Copy package files
COPY package.json package-lock.json ./
COPY mcp/package.json ./mcp/

# Install only production dependencies and global tools
RUN npm ci --omit=dev && \
    npm install -g tsx@4.20.6 mastra@0.18.0 && \
    npm cache clean --force

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
