# Build stage - use Bun image for building
FROM docker.io/oven/bun:1-alpine AS builder

WORKDIR /workspace

# Install jq for JSON manipulation
RUN apk add --no-cache jq

# Copy package files for dependency installation
COPY package.json ./package.json.original
COPY mcp/package.json ./mcp/

# Remove workspaces field and husky prepare script from package.json 
# since Docker context doesn't include all workspace packages
RUN jq 'del(.workspaces) | del(.scripts.prepare)' package.json.original > package.json && rm package.json.original

# Install all dependencies (needed for TypeScript compilation)
RUN bun install

# Copy source code
COPY tsconfig.base.json ./
COPY mcp/ ./mcp/

# Production stage - use Bun Alpine for runtime (needed for mastra studio CLI)
FROM docker.io/oven/bun:1-alpine AS production

ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV MASTRA_SERVER_PORT=4111
ENV MCP_SERVER_PORT=4112
ENV MASTRA_STUDIO_PORT=3000

WORKDIR /workspace

# Install supervisor for process management, wget for healthcheck, and netcat for port checking
RUN apk add --no-cache supervisor wget netcat-openbsd

# Copy node_modules and package files
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/package.json ./package.json

# Copy mastra source files (needed for mastra studio and running server directly)
COPY --from=builder /workspace/tsconfig.base.json ./tsconfig.base.json
COPY --from=builder /workspace/mcp ./mcp

# Copy runtime scripts and configuration
COPY mcp/supervisord.conf /etc/supervisord.conf
COPY mcp/healthcheck.sh /workspace/healthcheck.sh

# Expose ports for services (4111: Mastra Server, 4112: MCP Server, 3000: Studio UI)
EXPOSE 4111 4112 3000

# Make healthcheck executable
RUN chmod +x /workspace/healthcheck.sh

# Health check to verify all services are running
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD ["/workspace/healthcheck.sh"]

# Run supervisord directly (no bash needed)
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
