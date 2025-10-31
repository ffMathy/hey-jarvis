#!/usr/bin/with-contenv bashio
# ==============================================================================
# Home Assistant Add-on: Hey Jarvis MCP Server
# Runs the Jarvis MCP Server with configuration from Home Assistant
# ==============================================================================

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

# Start the server
bashio::log.info "Starting Mastra MCP Server on port ${PORT}..."
# Run the Mastra server from the MCP project
exec tsx mcp/mastra/server.ts
