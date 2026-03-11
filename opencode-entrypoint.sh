#!/bin/sh
# OpenCode sidecar entrypoint.
# Starts a thin Azure OpenAI proxy (azure-proxy.js) on port 11440,
# then redirects OpenCode's built-in openai provider to it via OPENAI_BASE_URL env var.
# This bypasses OpenCode bug #12186 (cognitiveservices.azure.com not supported).

CONFIG_DIR="/root/.config/opencode"
mkdir -p "$CONFIG_DIR"

# Start the Azure proxy in background if Azure credentials are set
if [ -n "$AZURE_OPENAI_ENDPOINT" ] && [ -n "$AZURE_OPENAI_API_KEY" ]; then
  echo "[opencode-entrypoint] Starting Azure proxy on port 11440 -> $AZURE_OPENAI_ENDPOINT"
  node /usr/local/bin/azure-proxy.js &

  # Wait for proxy to be ready (up to 10s)
  i=0
  while [ $i -lt 20 ]; do
    if curl -sf http://127.0.0.1:11440/ > /dev/null 2>&1; then
      echo "[opencode-entrypoint] Azure proxy ready"
      break
    fi
    sleep 0.5
    i=$((i + 1))
  done

  # Point the OpenAI SDK at our proxy via env vars (bypasses OpenCode config schema validation)
  export OPENAI_API_KEY="azure-proxy"
  export OPENAI_BASE_URL="http://127.0.0.1:11440/v1"
  echo "[opencode-entrypoint] OPENAI_BASE_URL -> http://127.0.0.1:11440/v1"
else
  echo "[opencode-entrypoint] No Azure credentials — using opencode proxy models"
fi

# Minimal valid config — no provider overrides (using env vars above)
cat > "$CONFIG_DIR/opencode.json" << EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "permission": { "*": "allow" },
  "server": { "port": 4096, "hostname": "0.0.0.0" }
}
EOF

exec "$@"
