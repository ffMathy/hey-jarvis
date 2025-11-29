# Build stage - use Bun image for building
FROM docker.io/oven/bun:1-alpine AS builder

WORKDIR /workspace

# Copy package files for dependency installation (use docker-specific package.json without workspaces)
COPY mcp/docker-package.json ./package.json
COPY mcp/package.json ./mcp/

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
ENV OLLAMA_MODELS=/workspace/.ollama/models

WORKDIR /workspace

# Install bash, supervisor, curl (for Ollama installation), and other dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    supervisor \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

# Copy package files (use docker-specific package.json without workspaces)
COPY mcp/docker-package.json ./package.json
COPY mcp/package.json ./mcp/

# Install only production dependencies and global tools
RUN bun install --production

# Copy source code from builder
COPY --from=builder /workspace/tsconfig.base.json ./
COPY --from=builder /workspace/mcp/ ./mcp/

# Copy supervisord configuration
COPY mcp/supervisord.conf /etc/supervisord.conf

# Create directory for Ollama models
# Mount a volume here to persist models between container restarts
RUN mkdir -p /workspace/.ollama/models

# Note: The Gemma 3 model (gemma3:27b, ~16GB) is NOT pre-pulled to keep image size manageable.
# The model will be automatically pulled on first use by the agents.
# For faster startup, you can pre-pull the model by running:
#   docker exec <container> ollama pull gemma3:27b
# Or mount a volume with pre-downloaded models to /workspace/.ollama/models

# Expose ports for services (4111: Mastra UI, 4112: MCP Server, 11434: Ollama)
EXPOSE 4111 4112 11434

# Make run script executable
RUN chmod a+x ./mcp/run.sh

# Override the base image's entrypoint and use the run script
ENTRYPOINT [ "./mcp/run.sh" ]
