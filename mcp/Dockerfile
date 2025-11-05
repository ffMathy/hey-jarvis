# Production stage - use Node.js with tsx to run TypeScript directly
FROM docker.io/node:lts-bullseye

ENV HOST=0.0.0.0
ENV NODE_ENV=production

WORKDIR /workspace

# Copy package files for dependency installation
COPY package.json package-lock.json ./
COPY mcp/package.json ./mcp/

# Install all dependencies (we need TypeScript dependencies to run with tsx)
RUN npm install

# Install tsx and mastra globally for running TypeScript
RUN npm install -g tsx mastra

# Copy source code
COPY tsconfig.base.json ./
COPY mcp/ ./mcp/

# Expose ports for both services
EXPOSE 4111 4112

# Run both mastra dev (port 4111) and mcp-server (port 4112) in parallel
CMD [ "bash", "-c", "mastra dev --dir mcp/mastra --root . & npx tsx mcp/mastra/mcp-server.ts & wait" ]
