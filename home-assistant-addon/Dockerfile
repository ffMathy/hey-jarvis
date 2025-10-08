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

# Copy addon configuration (already exists in base image, but we ensure it's available)
# The base image already has the correct WORKDIR, ENV, EXPOSE, and CMD

# Add any Home Assistant specific configuration or scripts if needed
# For now, we just use the base jarvis-mcp image as-is

# The base image already exposes port 4111 and runs the Mastra server
# CMD is inherited from the base jarvis-mcp image
