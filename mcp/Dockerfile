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

# Production stage - use Bun Debian for Ollama compatibility (Ollama requires glibc)
FROM docker.io/oven/bun:1-debian AS production

ENV HOST=0.0.0.0
ENV NODE_ENV=production

# Ollama configuration
ENV OLLAMA_HOST=0.0.0.0
ENV OLLAMA_MODELS=/data/llm/models

WORKDIR /workspace

# Install bash, supervisor, curl (for Ollama installation), jq, and other dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    supervisor \
    curl \
    ca-certificates \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

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

# Create directory for Ollama models
# Mount a volume here to persist models between container restarts
RUN mkdir -p /data/llm/models

# Note: The Ollama models (qwen3:0.6b) are NOT pre-pulled to keep image size manageable.
# Models will be automatically pulled on first use by the lazy loading mechanism,
# or pulled at container startup via the pull-ollama-models.sh script.
# For faster startup, you can pre-pull the model by running:
#   docker exec <container> ollama pull qwen3:0.6b
# Or mount a volume with pre-downloaded models to /data/llm/models

# Expose ports for services (4111: Mastra UI, 4112: MCP Server, 11434: Ollama)
EXPOSE 4111 4112 11434

# Make scripts executable
RUN chmod a+x ./mcp/run.sh ./mcp/lib/pull-ollama-models.sh

# Override the base image's entrypoint and use the run script
ENTRYPOINT [ "./mcp/run.sh" ]
