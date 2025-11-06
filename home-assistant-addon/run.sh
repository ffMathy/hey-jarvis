#!/usr/bin/env bash
# ==============================================================================
# Home Assistant Add-on: Hey Jarvis MCP Server
# Runs the Jarvis MCP Server with configuration from Home Assistant
# ==============================================================================

# Source bashio library for Home Assistant addon configuration parsing
# shellcheck disable=SC1091
source /usr/lib/bashio/bashio.sh

bashio::log.info "Starting Hey Jarvis MCP Server..."

# Export environment variables from options if they are set
if bashio::config.has_value 'openweathermap_api_key'; then
    export HEY_JARVIS_OPENWEATHERMAP_API_KEY=$(bashio::config 'openweathermap_api_key')
    bashio::log.info "OpenWeatherMap API key configured"
fi

if bashio::config.has_value 'google_api_key'; then
    export HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY=$(bashio::config 'google_api_key')
    bashio::log.info "Google Generative AI API key configured"
fi

if bashio::config.has_value 'valdemarsro_api_key'; then
    export HEY_JARVIS_VALDEMARSRO_API_KEY=$(bashio::config 'valdemarsro_api_key')
    bashio::log.info "Valdemarsro API key configured"
fi

if bashio::config.has_value 'bilka_email'; then
    export HEY_JARVIS_BILKA_EMAIL=$(bashio::config 'bilka_email')
    bashio::log.info "Bilka email configured"
fi

if bashio::config.has_value 'bilka_password'; then
    export HEY_JARVIS_BILKA_PASSWORD=$(bashio::config 'bilka_password')
    bashio::log.info "Bilka password configured"
fi

if bashio::config.has_value 'bilka_api_key'; then
    export HEY_JARVIS_BILKA_API_KEY=$(bashio::config 'bilka_api_key')
    bashio::log.info "Bilka API key configured"
fi

if bashio::config.has_value 'bilka_user_token'; then
    export HEY_JARVIS_BILKA_USER_TOKEN=$(bashio::config 'bilka_user_token')
    bashio::log.info "Bilka user token configured"
fi

if bashio::config.has_value 'algolia_api_key'; then
    export HEY_JARVIS_ALGOLIA_API_KEY=$(bashio::config 'algolia_api_key')
    bashio::log.info "Algolia API key configured"
fi

if bashio::config.has_value 'algolia_application_id'; then
    export HEY_JARVIS_ALGOLIA_APPLICATION_ID=$(bashio::config 'algolia_application_id')
    bashio::log.info "Algolia Application ID configured"
fi

# Log level
LOG_LEVEL=$(bashio::config 'log_level')
bashio::log.info "Log level set to: ${LOG_LEVEL}"

# Start both servers in parallel
bashio::log.info "Starting Mastra development server on port ${PORT}..."
bashio::log.info "Starting J.A.R.V.I.S. MCP server on port 4112..."

# Run both mastra dev (port ${PORT}) and mcp-server (port 4112) in parallel
# Using & to run in background and wait to keep the script alive
mastra dev --dir mcp/mastra --root . --port "${PORT}" &
MASTRA_PID=$!

npx tsx mcp/mastra/mcp-server.ts &
MCP_PID=$!

# Wait for either process to exit (both should run indefinitely)
# If either exits, the addon should restart
wait -n
EXIT_CODE=$?
bashio::log.error "A server process has exited with code ${EXIT_CODE}"

# Check which process(es) stopped
MASTRA_RUNNING=true
MCP_RUNNING=true

if ! kill -0 $MASTRA_PID 2>/dev/null; then
    MASTRA_RUNNING=false
    bashio::log.error "Mastra development server has stopped"
fi

if ! kill -0 $MCP_PID 2>/dev/null; then
    MCP_RUNNING=false
    bashio::log.error "J.A.R.V.I.S. MCP server has stopped"
fi

# If both stopped, log that as well
if [ "$MASTRA_RUNNING" = false ] && [ "$MCP_RUNNING" = false ]; then
    bashio::log.error "Both servers have stopped"
fi

exit $EXIT_CODE
