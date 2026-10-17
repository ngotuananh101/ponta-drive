#!/bin/sh
set -e

# ==============================================================================
# Ponta Drive - Deployment Webhook Execution Script
#
# Safely triggers an external deployment webhook (e.g. Portainer, Coolify,
# Dokku, webhookd, or custom receiver) with first-class support for:
#   - Self-hosted / self-signed SSL certificates (-k / --insecure)
#   - Custom Certificate Authority (CA) bundles via DEPLOY_WEBHOOK_CA_CERT
#   - Automatic retries on transient network disconnects
#   - URL masking to prevent leaking webhook tokens or query strings in CI logs
# ==============================================================================

WEBHOOK_URL="${DEPLOY_WEBHOOK_URL:-$1}"

if [ -z "$WEBHOOK_URL" ]; then
  echo "[webhook] DEPLOY_WEBHOOK_URL is not set, skipping deployment webhook."
  exit 0
fi

# Default to allowing self-hosted/self-signed SSL unless explicitly disabled
ALLOW_INSECURE="${DEPLOY_WEBHOOK_INSECURE:-true}"

CURL_OPTS="-s -S -X POST --max-time 30 --retry 3 --retry-delay 2 --retry-connrefused"

CA_FILE=""
cleanup() {
  if [ -n "$CA_FILE" ] && [ -f "$CA_FILE" ]; then
    rm -f "$CA_FILE"
  fi
  if [ -n "$RESP_FILE" ] && [ -f "$RESP_FILE" ]; then
    rm -f "$RESP_FILE"
  fi
}
trap cleanup EXIT INT TERM

# If a custom CA certificate is provided as a secret/env var, mount it
if [ -n "$DEPLOY_WEBHOOK_CA_CERT" ]; then
  CA_FILE=$(mktemp /tmp/webhook-ca.XXXXXX.crt 2>/dev/null || mktemp)
  echo "$DEPLOY_WEBHOOK_CA_CERT" > "$CA_FILE"
  CURL_OPTS="$CURL_OPTS --cacert $CA_FILE"
  echo "[webhook] Using custom CA certificate for SSL verification."
elif [ "$ALLOW_INSECURE" = "true" ] || [ "$ALLOW_INSECURE" = "1" ]; then
  CURL_OPTS="$CURL_OPTS -k"
  echo "[webhook] Self-hosted SSL mode enabled (insecure/self-signed verification allowed with -k)."
fi

# Mask URL target (keep scheme + host, hide secret query/path) for CI logs
TARGET_HOST=$(echo "$WEBHOOK_URL" | sed -E 's|^([^:]+://[^/?#]+).*|\1|')
echo "[webhook] Triggering deployment webhook at $TARGET_HOST..."

RESP_FILE=$(mktemp /tmp/webhook-resp.XXXXXX.txt 2>/dev/null || mktemp)

CURL_EXIT=0
HTTP_CODE=$(curl $CURL_OPTS -w "%{http_code}" -o "$RESP_FILE" "$WEBHOOK_URL") || CURL_EXIT=$?

if [ "$CURL_EXIT" -ne 0 ]; then
  echo "[webhook] ERROR: curl exited with code $CURL_EXIT"
  if [ -s "$RESP_FILE" ]; then
    echo "[webhook] Response output:"
    head -n 20 "$RESP_FILE"
  fi
  exit "$CURL_EXIT"
fi

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 400 ]; then
  echo "[webhook] SUCCESS: Deployment webhook triggered successfully (HTTP $HTTP_CODE)."
  if [ -s "$RESP_FILE" ]; then
    RESPONSE_PREVIEW=$(head -n 5 "$RESP_FILE")
    if [ -n "$RESPONSE_PREVIEW" ]; then
      echo "[webhook] Response: $RESPONSE_PREVIEW"
    fi
  fi
  exit 0
else
  echo "[webhook] ERROR: Webhook server returned HTTP $HTTP_CODE"
  if [ -s "$RESP_FILE" ]; then
    echo "[webhook] Response body:"
    head -n 20 "$RESP_FILE"
  fi
  exit 1
fi
