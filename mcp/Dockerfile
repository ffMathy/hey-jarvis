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

# Install all dependencies (needed for runtime compilation)
RUN bun install

# Copy source code
COPY tsconfig.base.json ./
COPY mcp/ ./mcp/

# Bundle the Mastra server without compilation (allows top-level await)
# This creates a single bundled file with all dependencies
# Note: Cannot use bun build --compile because it doesn't support top-level await
# Skipping mastra build to avoid deployer dependency issues
RUN bun build ./mcp/mastra/server.ts \
    --target=bun \
    --format=esm \
    --minify \
    --outfile=./mcp/mastra-server.js

# Bundle MCP server (also cannot compile due to potential top-level await)
RUN bun build ./mcp/mastra/mcp-server.ts \
    --target=bun \
    --format=esm \
    --minify \
    --outfile=./mcp/mcp-server.js

# Production stage - use Bun Alpine image for runtime
# Need Bun runtime to execute bundled JS (cannot compile due to top-level await)
FROM docker.io/oven/bun:1-alpine AS production

ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV MASTRA_SERVER_PORT=4111
ENV MCP_SERVER_PORT=4112

WORKDIR /workspace

# Install supervisor for process management and wget for healthcheck
RUN apk add --no-cache supervisor wget

# Copy bundled server scripts from builder
COPY --from=builder /workspace/mcp/mastra-server.js ./mcp/mastra-server.js
COPY --from=builder /workspace/mcp/mcp-server.js ./mcp/mcp-server.js

# Copy runtime scripts and configuration
COPY mcp/supervisord.conf /etc/supervisord.conf
COPY mcp/healthcheck.sh /workspace/healthcheck.sh

# Expose ports for services (4111: Mastra Server, 4112: MCP Server)
EXPOSE 4111 4112

# Make healthcheck executable
RUN chmod +x /workspace/healthcheck.sh

# Health check to verify both services are running
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD ["/workspace/healthcheck.sh"]

# Run supervisord directly (no bash needed)
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
