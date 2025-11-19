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

# Configure JWT authentication if secret is provided
if bashio::config.has_value 'jwt_secret'; then
    export HEY_JARVIS_MCP_JWT_SECRET=$(bashio::config 'jwt_secret')
    bashio::log.info "JWT authentication enabled"
    
    # Create JWT key file for nginx-auth-jwt module
    # The module expects a JSON keyval format: {"kid": "secret"}
    # We use a fixed kid value since we're using HMAC (symmetric key)
    echo "{\"default\": \"${HEY_JARVIS_MCP_JWT_SECRET}\"}" > /tmp/jwt_key.json
    chmod 600 /tmp/jwt_key.json
    
    # Create nginx JWT auth configuration file
    cat > /etc/nginx/jwt-auth.conf <<EOF
# JWT Authentication configuration (auto-generated from Home Assistant config)
auth_jwt "Hey Jarvis MCP Server";
auth_jwt_key_file /tmp/jwt_key.json keyval;
# Allow JWT tokens with any expiry by setting a very high leeway (100 years)
# This makes exp validation effectively optional while still validating the signature
auth_jwt_leeway 3153600000;
EOF
    
    bashio::log.info "JWT key file created at /tmp/jwt_key.json"
else
    bashio::log.warning "JWT authentication disabled - no jwt_secret configured"
    
    # Create empty JWT auth configuration to disable authentication
    cat > /etc/nginx/jwt-auth.conf <<EOF
# JWT Authentication disabled - no jwt_secret configured
auth_jwt off;
EOF
fi

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

# Start nginx in background
bashio::log.info "Starting nginx proxy on ingress port 5690..."
nginx -g 'daemon off;' &
NGINX_PID=$!
bashio::log.info "Nginx started (PID: ${NGINX_PID})"

# Give nginx time to start
sleep 2

# Start both servers in parallel using shared function
PIDS=$(start_mcp_servers) || {
    bashio::log.error "Failed to start MCP servers"
    kill $NGINX_PID 2>/dev/null || true
    exit 1
}
read -r MASTRA_PID MCP_PID <<< "$PIDS"

# Function to cleanup on exit
cleanup() {
    bashio::log.info "Shutting down servers..."
    kill $MASTRA_PID $MCP_PID $NGINX_PID 2>/dev/null || true
}

trap cleanup EXIT INT TERM

# Wait for either process to exit and handle status
wait_for_server_exit "$MASTRA_PID" "$MCP_PID"
EXIT_CODE=$?

# Cleanup nginx
kill $NGINX_PID 2>/dev/null || true

bashio::log.error "A server process has exited with code ${EXIT_CODE}"
exit $EXIT_CODE
