# Build stage - use Bun image for building
# Pinned by digest so the base image is immutable; Dependabot keeps the tag and
# digest in sync. Keep the version aligned with `packageManager` in package.json.
FROM docker.io/oven/bun:1.3.9-alpine@sha256:9028ee7a60a04777190f0c3129ce49c73384d3fc918f3e5c75f5af188e431981 AS builder

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

# 1Password CLI, pinned by digest. Secrets are resolved at runtime from a service
# account rather than baked into the image or handed over as plaintext env files,
# so the CLI has to be present in the runtime stage. Published for amd64, arm64
# and arm/v7 — the same architectures this image is built for.
FROM docker.io/1password/op:2.39.0@sha256:3cd5a1febc662c93d46b944b983b301e710da5c016ef63be9d436cf2b1ed30d5 AS onepassword

# Production stage - use Bun Alpine for runtime (needed for mastra studio CLI)
FROM docker.io/oven/bun:1.3.9-alpine@sha256:9028ee7a60a04777190f0c3129ce49c73384d3fc918f3e5c75f5af188e431981 AS production

ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV MASTRA_SERVER_PORT=4111
ENV MCP_SERVER_PORT=4112
ENV WORKSPACE_ROOT=/workspace

WORKDIR /workspace

# Install supervisor for process management, wget for healthcheck, netcat for
# port checking, and bash to run run-with-env.sh
RUN apk add --no-cache supervisor wget netcat-openbsd bash

# The 1Password CLI resolves the op:// references in mcp/op.env at startup
COPY --from=onepassword /usr/local/bin/op /usr/local/bin/op

# Copy node_modules and package files
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/package.json ./package.json

# Copy mastra source files (needed for mastra studio and running server directly)
COPY --from=builder /workspace/tsconfig.base.json ./tsconfig.base.json
COPY --from=builder /workspace/mcp ./mcp

# Copy runtime scripts and configuration
COPY mcp/supervisord.conf /etc/supervisord.conf
COPY mcp/healthcheck.sh /workspace/healthcheck.sh
COPY .scripts/run-with-env.sh /workspace/.scripts/run-with-env.sh

# Expose ports for services (4111: Mastra Server + UI, 4112: MCP Server)
EXPOSE 4111 4112

# Make healthcheck and secret-resolving wrapper executable
RUN chmod +x /workspace/healthcheck.sh /workspace/.scripts/run-with-env.sh

# Health check to verify all services are running
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD ["/workspace/healthcheck.sh"]

# Run supervisord directly (no bash needed)
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
