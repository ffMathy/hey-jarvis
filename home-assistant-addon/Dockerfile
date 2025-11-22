# Home Assistant Addon Wrapper for MCP Server
# This addon wraps the MCP Docker image to make it available as a Home Assistant Addon

# Use the MCP image as base
# In production, this should reference the built MCP image from the registry
ARG BUILD_FROM=ghcr.io/ffmathy/mcp:latest
FROM ${BUILD_FROM} AS base

# Add Home Assistant addon labels
LABEL io.hass.name="Hey Jarvis MCP Server"
LABEL io.hass.description="AI-powered home assistant with Mastra agents for weather, shopping, cooking, and more via Model Context Protocol"
LABEL io.hass.arch="amd64|aarch64"
LABEL io.hass.type="addon"
LABEL maintainer="Mathias Lykkegaard Lorenzen <mathias.lorenzen@live.com>"
LABEL io.hass.url="https://github.com/ffMathy/hey-jarvis"

# Install bashio for Home Assistant addon configuration parsing
# Bashio is the standard library for Home Assistant addons
RUN apk add --no-cache curl jq && \
    curl -J -L -o /tmp/bashio.tar.gz \
    "https://github.com/hassio-addons/bashio/archive/v0.16.2.tar.gz" && \
    mkdir -p /tmp/bashio && \
    tar zxvf /tmp/bashio.tar.gz --strip 1 -C /tmp/bashio && \
    mv /tmp/bashio/lib /usr/lib/bashio && \
    ln -s /usr/lib/bashio/bashio /usr/bin/bashio && \
    rm -rf /tmp/bashio /tmp/bashio.tar.gz


# we define this stage to simulate how Home Assistant's ingress works locally.
FROM base AS home-assistant-addon-end-to-end-test

# Install nginx for ingress simulation
RUN apk add --no-cache nginx

# Copy nginx test configuration
COPY tests/nginx.tests.conf /etc/nginx/http.d/default.conf

# Copy test entrypoint script
COPY tests/run-test.sh /run-test.sh
RUN chmod +x /run-test.sh

# Override entrypoint to start the MCP server
ENTRYPOINT ["/run-test.sh"]


# the last stage is the final image used by Home Assistant.
FROM base AS final
