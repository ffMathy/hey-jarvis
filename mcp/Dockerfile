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

# Install all dependencies (needed for TypeScript compilation and mastra build)
RUN bun install

# Copy source code
COPY tsconfig.base.json ./
COPY mcp/ ./mcp/

# Build Mastra application using official mastra build command
# This creates .mastra/output/ with bundled Hono server
RUN cd mcp && bunx mastra build --dir ./mastra

# Compile Mastra output to native binary with bytecode for faster startup and smaller size
# Using --target=bun ensures compatibility with Bun runtime features
RUN bun build --compile --minify --bytecode --target=bun \
    ./mcp/.mastra/output/index.mjs \
    --outfile ./mcp/mastra-server

# Compile MCP server to native binary with bytecode for faster startup and smaller size
RUN bun build --compile --minify --bytecode --target=bun \
    ./mcp/mastra/mcp-server.ts \
    --outfile ./mcp/mcp-server

# Production stage - use Alpine for smaller image size
# No need for Bun runtime since we're running native compiled binaries
FROM docker.io/alpine:3.21 AS production

ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV MASTRA_SERVER_PORT=4111
ENV MCP_SERVER_PORT=4112

WORKDIR /workspace

# Install supervisor for process management and wget for healthcheck
RUN apk add --no-cache supervisor wget

# Copy compiled Mastra server binary from builder
COPY --from=builder /workspace/mcp/mastra-server ./mcp/mastra-server

# Copy compiled MCP server binary from builder
COPY --from=builder /workspace/mcp/mcp-server ./mcp/mcp-server

# Copy runtime scripts and configuration
COPY mcp/supervisord.conf /etc/supervisord.conf
COPY mcp/healthcheck.sh /workspace/healthcheck.sh

# Expose ports for services (4111: Mastra Server, 4112: MCP Server)
EXPOSE 4111 4112

# Make binaries and healthcheck executable
RUN chmod +x ./mcp/mastra-server ./mcp/mcp-server /workspace/healthcheck.sh

# Health check to verify both services are running
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD ["/workspace/healthcheck.sh"]

# Run supervisord directly (no bash needed)
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
