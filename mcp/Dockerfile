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

# Production stage - use Bun Alpine for smaller image size
# Ollama is now installed as a separate Home Assistant extension
FROM docker.io/oven/bun:1-alpine AS production

ENV HOST=0.0.0.0
ENV NODE_ENV=production

WORKDIR /workspace

# Install bash, supervisor, and jq for runtime needs
RUN apk add --no-cache \
    bash \
    supervisor \
    jq

# Copy package files
COPY package.json ./package.json.original
COPY mcp/package.json ./mcp/

# Remove workspaces field and husky prepare script from package.json
# since Docker context doesn't include all workspace packages
RUN jq 'del(.workspaces) | del(.scripts.prepare)' package.json.original > package.json && rm package.json.original

# Install only production dependencies and global tools
RUN bun install --production

# Copy source code from builder
COPY --from=builder /workspace/tsconfig.base.json ./
COPY --from=builder /workspace/mcp/ ./mcp/

# Copy supervisord configuration
COPY mcp/supervisord.conf /etc/supervisord.conf

# Expose ports for services (4111: Mastra UI, 4112: MCP Server)
EXPOSE 4111 4112

# Make scripts executable
RUN chmod a+x ./mcp/run.sh

# Override the base image's entrypoint and use the run script
ENTRYPOINT [ "./mcp/run.sh" ]
