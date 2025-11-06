# Home Assistant Addon Wrapper for MCP Server
# This addon wraps the MCP Docker image to make it available as a Home Assistant Addon

# Use the MCP image as base
# In production, this should reference the built MCP image from the registry
ARG BUILD_FROM=ghcr.io/ffmathy/mcp:latest
FROM ${BUILD_FROM}

# Add Home Assistant addon labels
LABEL io.hass.name="Hey Jarvis MCP Server"
LABEL io.hass.description="AI-powered home assistant with Mastra agents for weather, shopping, cooking, and more via Model Context Protocol"
LABEL io.hass.arch="amd64|aarch64"
LABEL io.hass.type="addon"
LABEL maintainer="Mathias Lykkegaard Lorenzen <mathias.lorenzen@live.com>"
LABEL io.hass.url="https://github.com/ffMathy/hey-jarvis"

# Install bashio for Home Assistant addon configuration parsing
# Bashio is the standard library for Home Assistant addons
RUN apt-get update && \
    apt-get install -y --no-install-recommends bash curl jq && \
    curl -J -L -o /tmp/bashio.tar.gz \
    "https://github.com/hassio-addons/bashio/archive/v0.16.2.tar.gz" && \
    mkdir -p /tmp/bashio && \
    tar zxvf /tmp/bashio.tar.gz --strip 1 -C /tmp/bashio && \
    mv /tmp/bashio/lib /usr/lib/bashio && \
    ln -s /usr/lib/bashio/bashio /usr/bin/bashio && \
    rm -rf /tmp/bashio /tmp/bashio.tar.gz && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy the run script
COPY run.sh /
RUN chmod a+x /run.sh

# Override the base image's entrypoint and use the run script
# The node:lts base image has docker-entrypoint.sh which expects node commands,
# so we need to explicitly set our own entrypoint
ENTRYPOINT [ "/run.sh" ]
