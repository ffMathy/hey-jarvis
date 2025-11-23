#!/usr/bin/env bash
# ==============================================================================
# Centralized Port Configuration for Hey Jarvis Services
# ==============================================================================
# This file defines all ports used by the Hey Jarvis system in one place.
# Follow DRY (Don't Repeat Yourself) principle - update ports here, not in individual files.

# Service ports (exposed directly by Node.js services)
export MASTRA_UI_PORT=4111
export MCP_SERVER_PORT=4112

# Test ingress port (for Home Assistant ingress simulation)
export TEST_INGRESS_PORT=5000

# Test external ports (different from service ports to avoid conflicts with devcontainer)
# Using offset +10000 to avoid conflicts with devcontainer port forwarding
export TEST_MASTRA_UI_PORT=14111
export TEST_MCP_SERVER_PORT=14112
export TEST_INGRESS_EXTERNAL_PORT=15000
