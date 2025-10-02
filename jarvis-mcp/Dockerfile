FROM docker.io/node:lts-alpine

# Install dependencies required for native modules (libsql)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite-libs \
    sqlite-dev

ENV HOST=0.0.0.0
ENV PORT=4111

WORKDIR /app

# Copy the built Mastra application
COPY .mastra/output ./

# Expose the port for Mastra server
EXPOSE 4111

# Run the built Mastra application
CMD [ "node", "./index.mjs" ]
