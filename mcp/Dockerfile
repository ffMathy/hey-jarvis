# Production stage - use Node.js with tsx to run TypeScript directly
# Using node:lts which has better multi-arch support including armv7
FROM docker.io/node:lts

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

# Copy the run script
RUN chmod a+x ./mcp/run.sh

# Override the base image's entrypoint and use the run script
# The node:lts base image has docker-entrypoint.sh which expects node commands,
# so we need to explicitly set our own entrypoint
ENTRYPOINT [ "./mcp/run.sh" ]