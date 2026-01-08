#!/usr/bin/env bash
# ==============================================================================
# Centralized Port Configuration for Hey Jarvis Services
# ==============================================================================
# This file defines all ports used by the Hey Jarvis system in one place.
# Follow DRY (Don't Repeat Yourself) principle - update ports here, not in individual files.

# External service ports (exposed via nginx)
export MASTRA_SERVER_PORT=4111
export MCP_SERVER_PORT=4112
export MASTRA_STUDIO_PORT=4111

# Internal service ports (not exposed directly, nginx proxies to these)
export MASTRA_SERVER_INTERNAL_PORT=8111
export MCP_SERVER_INTERNAL_PORT=4112
export MASTRA_STUDIO_INTERNAL_PORT=8113

# Test ingress port (for Home Assistant ingress simulation)
export TEST_INGRESS_PORT=5000

# Test external ports (different from service ports to avoid conflicts with devcontainer)
# Using offset +10000 to avoid conflicts with devcontainer port forwarding
export TEST_MASTRA_SERVER_PORT=14111
export TEST_MCP_SERVER_PORT=14112
export TEST_INGRESS_EXTERNAL_PORT=15000
