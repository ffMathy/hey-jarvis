# Production stage - use Node.js with tsx to run TypeScript directly
FROM docker.io/node:lts-bullseye

ENV HOST=0.0.0.0
ENV PORT=4111
ENV NODE_ENV=production

WORKDIR /workspace

# Copy package files for dependency installation
COPY package.json package-lock.json ./
COPY mcp/package.json ./mcp/

# Install all dependencies (we need TypeScript dependencies to run with tsx)
RUN npm install

# Install tsx globally for running TypeScript
RUN npm install -g tsx

# Copy source code
COPY tsconfig.base.json ./
COPY mcp/ ./mcp/

# Expose the port for Mastra server
EXPOSE 4111

# Use tsx to run TypeScript directly - simpler and more reliable than mastra build
CMD [ "tsx", "mcp/mastra/server.ts" ]
