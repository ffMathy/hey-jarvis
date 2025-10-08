#!/bin/bash
# ==============================================================================
# Home Assistant Add-on: Hey Jarvis MCP Server
# Runs the Jarvis MCP Server with configuration from Home Assistant
# ==============================================================================

set -e

echo "Starting Hey Jarvis MCP Server..."

# Read configuration from Home Assistant options
CONFIG_PATH=/data/options.json

# Export environment variables from options if they are set and not empty
if [ -f "$CONFIG_PATH" ]; then
    # Read each configuration value and export as environment variable if not empty
    OPENWEATHERMAP_API_KEY=$(jq -r '.openweathermap_api_key // empty' "$CONFIG_PATH")
    if [ -n "$OPENWEATHERMAP_API_KEY" ]; then
        export HEY_JARVIS_OPENWEATHERMAP_API_KEY="$OPENWEATHERMAP_API_KEY"
        echo "OpenWeatherMap API key configured"
    fi

    GOOGLE_API_KEY=$(jq -r '.google_api_key // empty' "$CONFIG_PATH")
    if [ -n "$GOOGLE_API_KEY" ]; then
        export HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY="$GOOGLE_API_KEY"
        echo "Google Generative AI API key configured"
    fi

    VALDEMARSRO_API_KEY=$(jq -r '.valdemarsro_api_key // empty' "$CONFIG_PATH")
    if [ -n "$VALDEMARSRO_API_KEY" ]; then
        export HEY_JARVIS_VALDEMARSRO_API_KEY="$VALDEMARSRO_API_KEY"
        echo "Valdemarsro API key configured"
    fi

    BILKA_EMAIL=$(jq -r '.bilka_email // empty' "$CONFIG_PATH")
    if [ -n "$BILKA_EMAIL" ]; then
        export HEY_JARVIS_BILKA_EMAIL="$BILKA_EMAIL"
        echo "Bilka email configured"
    fi

    BILKA_PASSWORD=$(jq -r '.bilka_password // empty' "$CONFIG_PATH")
    if [ -n "$BILKA_PASSWORD" ]; then
        export HEY_JARVIS_BILKA_PASSWORD="$BILKA_PASSWORD"
        echo "Bilka password configured"
    fi

    BILKA_API_KEY=$(jq -r '.bilka_api_key // empty' "$CONFIG_PATH")
    if [ -n "$BILKA_API_KEY" ]; then
        export HEY_JARVIS_BILKA_API_KEY="$BILKA_API_KEY"
        echo "Bilka API key configured"
    fi

    BILKA_USER_TOKEN=$(jq -r '.bilka_user_token // empty' "$CONFIG_PATH")
    if [ -n "$BILKA_USER_TOKEN" ]; then
        export HEY_JARVIS_BILKA_USER_TOKEN="$BILKA_USER_TOKEN"
        echo "Bilka user token configured"
    fi

    ALGOLIA_API_KEY=$(jq -r '.algolia_api_key // empty' "$CONFIG_PATH")
    if [ -n "$ALGOLIA_API_KEY" ]; then
        export HEY_JARVIS_ALGOLIA_API_KEY="$ALGOLIA_API_KEY"
        echo "Algolia API key configured"
    fi

    ALGOLIA_APPLICATION_ID=$(jq -r '.algolia_application_id // empty' "$CONFIG_PATH")
    if [ -n "$ALGOLIA_APPLICATION_ID" ]; then
        export HEY_JARVIS_ALGOLIA_APPLICATION_ID="$ALGOLIA_APPLICATION_ID"
        echo "Algolia Application ID configured"
    fi

    # Log level
    LOG_LEVEL=$(jq -r '.log_level // "info"' "$CONFIG_PATH")
    echo "Log level set to: ${LOG_LEVEL}"
else
    echo "Warning: Configuration file not found at $CONFIG_PATH, using default environment variables"
fi

# Start the server
echo "Starting Mastra MCP Server on port ${PORT:-4111}..."
exec tsx jarvis-mcp/mastra/server.ts
