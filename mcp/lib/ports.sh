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
