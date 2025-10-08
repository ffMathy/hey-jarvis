# Home Assistant Addon for Hey Jarvis MCP Server
# This addon wraps the jarvis-mcp Docker image to make it available as a Home Assistant Addon

# Use the jarvis-mcp image as base
# In production, this should reference the built jarvis-mcp image from the registry
ARG BUILD_FROM=ghcr.io/ffmathy/jarvis-mcp:latest
FROM ${BUILD_FROM}

# Add Home Assistant addon labels
LABEL io.hass.name="Hey Jarvis MCP Server"
LABEL io.hass.description="AI-powered home assistant with Mastra agents for weather, shopping, cooking, and more via Model Context Protocol"
LABEL io.hass.arch="amd64|armv7|aarch64"
LABEL io.hass.type="addon"
LABEL maintainer="Mathias Lykkegaard Lorenzen <ffmathy@gmail.com>"
LABEL io.hass.url="https://github.com/ffMathy/hey-jarvis"

# Install bashio for Home Assistant addon helper functions
RUN apt-get update && apt-get install -y --no-install-recommends \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install bashio from GitHub
RUN curl -J -L -o /tmp/bashio.tar.gz \
    "https://github.com/hassio-addons/bashio/archive/v0.16.2.tar.gz" \
    && mkdir -p /usr/lib/bashio \
    && tar zxvf /tmp/bashio.tar.gz --strip 1 -C /usr/lib/bashio \
    && rm -f /tmp/bashio.tar.gz

# Copy the run script
COPY home-assistant-addon/run.sh /run.sh
RUN chmod a+x /run.sh

# Use the run script as entrypoint
CMD [ "/run.sh" ]
