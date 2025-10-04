# Production stage - use Node.js with tsx to run TypeScript directly
FROM docker.io/node:lts-bullseye

ENV HOST=0.0.0.0
ENV PORT=4111
ENV NODE_ENV=production

WORKDIR /workspace

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

# Use tsx to run TypeScript directly - simpler and more reliable than mastra build
CMD [ "tsx", "jarvis-mcp/mastra/server.ts" ]
