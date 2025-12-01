#!/usr/bin/env bash
# ==============================================================================
# Pull required Ollama models
# This script ensures all required Ollama models are available
# ==============================================================================

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ollama API endpoint
OLLAMA_HOST="${OLLAMA_HOST:-localhost}"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"
OLLAMA_API="http://${OLLAMA_HOST}:${OLLAMA_PORT}"

# Required models
REQUIRED_MODELS=(
  "qwen3:0.6b"
)

# Wait for Ollama to be ready
wait_for_ollama() {
  local max_attempts=30
  local attempt=1
  
  echo "⏳ Waiting for Ollama to be ready..."
  
  while [ $attempt -le $max_attempts ]; do
    if curl -s "${OLLAMA_API}/api/tags" > /dev/null 2>&1; then
      echo "✅ Ollama is ready"
      return 0
    fi
    
    echo "   Attempt ${attempt}/${max_attempts}..."
    sleep 2
    attempt=$((attempt + 1))
  done
  
  echo "❌ Ollama did not become ready in time"
  return 1
}

# Check if a model is available
is_model_available() {
  local model_name="$1"
  local base_name="${model_name%%:*}"
  
  # Use jq for robust JSON parsing (jq is already installed in the container)
  local models=$(curl -s "${OLLAMA_API}/api/tags" 2>/dev/null | jq -r '.models[]?.name // empty' 2>/dev/null)
  
  for m in $models; do
    if [[ "$m" == "$model_name" ]] || [[ "$m" == "${base_name}:"* ]]; then
      return 0
    fi
  done
  
  return 1
}

# Pull a model
pull_model() {
  local model_name="$1"
  
  echo "📥 Pulling model: ${model_name}..."
  
  if curl -s -X POST "${OLLAMA_API}/api/pull" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${model_name}\", \"stream\": false}" > /dev/null 2>&1; then
    echo "✅ Successfully pulled: ${model_name}"
    return 0
  else
    echo "❌ Failed to pull: ${model_name}"
    return 1
  fi
}

# Main function
main() {
  echo "🚀 Starting Ollama model preparation..."
  
  # Wait for Ollama to be ready
  wait_for_ollama || exit 1
  
  # Pull required models
  local failed=0
  for model in "${REQUIRED_MODELS[@]}"; do
    if is_model_available "$model"; then
      echo "✅ Model already available: ${model}"
    else
      if ! pull_model "$model"; then
        failed=$((failed + 1))
      fi
    fi
  done
  
  if [ $failed -gt 0 ]; then
    echo "⚠️ Warning: ${failed} model(s) failed to pull"
    exit 1
  fi
  
  echo "✅ All required Ollama models are ready"
}

main "$@"
