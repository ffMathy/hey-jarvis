# Build stage - use Bun image for building
# Pinned by digest so the base image is immutable; Dependabot keeps the tag and
# digest in sync. Keep the version aligned with `packageManager` in package.json.
FROM docker.io/oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS builder

WORKDIR /workspace

# Copy the install manifests first so dependency layers cache independently of
# source changes. bunfig.toml comes along deliberately: it is what disables
# lifecycle scripts and enforces exact versions inside the image too.
COPY package.json bun.lock bunfig.toml .npmrc ./
COPY mcp/package.json ./mcp/
COPY elevenlabs/package.json ./elevenlabs/
COPY home-assistant-voice-firmware/package.json ./home-assistant-voice-firmware/

# --frozen-lockfile installs exactly what bun.lock pins and fails if anything
# would have to be resolved fresh from the registry.
RUN bun install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY mcp/ ./mcp/

# Production stage - use Bun Alpine for runtime (needed for mastra studio CLI)
FROM docker.io/oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS production

ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV MASTRA_SERVER_PORT=4111
ENV MCP_SERVER_PORT=4112
ENV WORKSPACE_ROOT=/workspace

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

# Expose ports for services (4111: Mastra Server + UI, 4112: MCP Server)
EXPOSE 4111 4112

# Make healthcheck executable
RUN chmod +x /workspace/healthcheck.sh

# Health check to verify all services are running
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD ["/workspace/healthcheck.sh"]

# Run supervisord directly (no bash needed)
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
