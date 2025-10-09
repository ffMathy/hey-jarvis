# Production stage - use Node.js with tsx to run TypeScript directly
FROM docker.io/node:lts-bullseye

ENV HOST=0.0.0.0
ENV PORT=4111
ENV NODE_ENV=production

WORKDIR /workspace

# Install build tools needed for native module rebuilding (python, make, g++)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files for dependency installation
COPY package.json package-lock.json* ./
COPY jarvis-mcp/package.json ./jarvis-mcp/

# Install all dependencies (we need TypeScript dependencies to run with tsx)
RUN npm install

# Install tsx globally for running TypeScript
RUN npm install -g tsx

# Copy necessary files for running the application
COPY nx.json tsconfig.base.json ./
COPY jarvis-mcp/ ./jarvis-mcp/

# Expose the port for Mastra server
EXPOSE 4111

# Copy and set up entrypoint script
COPY jarvis-mcp/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Use entrypoint to rebuild native modules on startup for target architecture
ENTRYPOINT ["/docker-entrypoint.sh"]

# Use tsx to run TypeScript directly - simpler and more reliable than mastra build
CMD [ "tsx", "jarvis-mcp/mastra/server.ts" ]
