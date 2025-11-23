#!/usr/bin/env bash
# ==============================================================================
# Home Assistant Add-on: Hey Jarvis MCP Server
# Runs the Jarvis MCP Server with configuration from Home Assistant
# ==============================================================================

# Source bashio library for Home Assistant addon configuration parsing
# shellcheck disable=SC1091
source /usr/lib/bashio/bashio.sh

# Source shared server start functions
# shellcheck disable=SC1091
source /workspace/mcp/lib/server-functions.sh

bashio::log.info "Starting Hey Jarvis MCP Server..."

# JWT authentication is mandatory for security
export HEY_JARVIS_MCP_JWT_SECRET=$(bashio::config 'jwt_secret')
if [ -z "$HEY_JARVIS_MCP_JWT_SECRET" ]; then
    bashio::log.error "FATAL: jwt_secret is required but not configured"
    bashio::log.error "The MCP server cannot run without JWT authentication for security reasons"
    bashio::log.error "Please configure jwt_secret in the addon configuration"
    exit 1
fi

bashio::log.info "JWT authentication enabled"

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

# Google OAuth credentials (for Calendar and Tasks)
if bashio::config.has_value 'google_client_id'; then
    export HEY_JARVIS_GOOGLE_CLIENT_ID=$(bashio::config 'google_client_id')
    bashio::log.info "Google Client ID configured"
fi

if bashio::config.has_value 'google_client_secret'; then
    export HEY_JARVIS_GOOGLE_CLIENT_SECRET=$(bashio::config 'google_client_secret')
    bashio::log.info "Google Client Secret configured"
fi

if bashio::config.has_value 'google_refresh_token'; then
    export HEY_JARVIS_GOOGLE_REFRESH_TOKEN=$(bashio::config 'google_refresh_token')
    bashio::log.info "Google Refresh Token configured"
fi

# Microsoft OAuth2 (for Outlook/Email)
if bashio::config.has_value 'microsoft_client_id'; then
    export HEY_JARVIS_MICROSOFT_CLIENT_ID=$(bashio::config 'microsoft_client_id')
    bashio::log.info "Microsoft Client ID configured"
fi

if bashio::config.has_value 'microsoft_client_secret'; then
    export HEY_JARVIS_MICROSOFT_CLIENT_SECRET=$(bashio::config 'microsoft_client_secret')
    bashio::log.info "Microsoft Client Secret configured"
fi

if bashio::config.has_value 'microsoft_refresh_token'; then
    export HEY_JARVIS_MICROSOFT_REFRESH_TOKEN=$(bashio::config 'microsoft_refresh_token')
    bashio::log.info "Microsoft Refresh Token configured"
fi

# Home Assistant integration
if bashio::config.has_value 'home_assistant_url'; then
    export HEY_JARVIS_HOME_ASSISTANT_URL=$(bashio::config 'home_assistant_url')
    bashio::log.info "Home Assistant URL configured"
fi

if bashio::config.has_value 'home_assistant_token'; then
    export HEY_JARVIS_HOME_ASSISTANT_TOKEN=$(bashio::config 'home_assistant_token')
    bashio::log.info "Home Assistant Token configured"
fi

# Tavily web research
if bashio::config.has_value 'tavily_api_key'; then
    export HEY_JARVIS_TAVILY_API_KEY=$(bashio::config 'tavily_api_key')
    bashio::log.info "Tavily API key configured"
fi

# Meal plan notification email
if bashio::config.has_value 'meal_plan_notification_email'; then
    export HEY_JARVIS_MEAL_PLAN_NOTIFICATION_EMAIL=$(bashio::config 'meal_plan_notification_email')
    bashio::log.info "Meal plan notification email configured"
fi

# Log level
LOG_LEVEL=$(bashio::config 'log_level')
bashio::log.info "Log level set to: ${LOG_LEVEL}"

# Start both servers in parallel using shared function
# Note: If supervisord is available, this will exec and replace the process
# The cleanup and wait logic below only runs if supervisord is not available
PIDS=$(start_mcp_servers) || {
    # Only reached if start_mcp_servers returns an error (not using exec)
    bashio::log.error "Failed to start MCP servers"
    exit 1
}

# The code below only runs if supervisord is not available (fallback mode)
# In that case, start_mcp_servers returns PIDs
if [ -n "$PIDS" ]; then
    read -r MASTRA_PID MCP_PID <<< "$PIDS"
    
    # Function to cleanup on exit
    cleanup() {
        bashio::log.info "Shutting down servers..."
        kill $MASTRA_PID $MCP_PID 2>/dev/null || true
    }
    
    trap cleanup EXIT INT TERM
    
    # Wait for either process to exit and handle status
    wait_for_server_exit "$MASTRA_PID" "$MCP_PID"
    EXIT_CODE=$?
    
    bashio::log.error "A server process has exited with code ${EXIT_CODE}"
    exit $EXIT_CODE
fi
