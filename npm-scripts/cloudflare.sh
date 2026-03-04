#!/usr/bin/env bash
set -euo pipefail

# Cloudflare Tunnel — lifecycle management via the Cloudflare API.
#
# Creates, configures, and tears down a Cloudflare Tunnel that exposes
# the rockpool compose stack (dashboard, IDE, preview) to the internet.
#
# Usage: npm run cf -- <command> [args]
#
# Commands:
#   setup <domain>     Create tunnel, configure ingress, create DNS records
#   status             Show tunnel status and connected connectors
#   teardown           Delete DNS records, tunnel configuration, and tunnel
#   token              Print the saved tunnel token
#   dns                List DNS records created for the tunnel
#
# Environment:
#   CF_API_TOKEN       Cloudflare API token (Tunnel:Edit + DNS:Edit)
#   CF_ACCOUNT_ID      Cloudflare account ID
#   CF_ZONE_ID         Cloudflare zone ID
#
# These can also be set in a .cloudflare file in the project root.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

TUNNEL_NAME="rockpool"
METADATA_FILE="${ROOT_DIR}/.tunnel-metadata.json"
TOKEN_FILE="${ROOT_DIR}/.tunnel-token"
CF_CONFIG_FILE="${ROOT_DIR}/.cloudflare"
CF_API_BASE="https://api.cloudflare.com/client/v4"

usage() {
  sed -n '/^# Usage:/,/^$/{ s/^# \?//; p }' "$0"
}

if [ $# -lt 1 ]; then
  usage
  exit 1
fi

COMMAND="$1"
shift

# ---------------------------------------------------------------------------
# Load configuration
# ---------------------------------------------------------------------------

if [ -f "$CF_CONFIG_FILE" ]; then
  # shellcheck source=/dev/null
  source "$CF_CONFIG_FILE"
fi

require_env() {
  local missing=()

  if [ -z "${CF_API_TOKEN:-}" ]; then
    missing+=("CF_API_TOKEN")
  fi
  if [ -z "${CF_ACCOUNT_ID:-}" ]; then
    missing+=("CF_ACCOUNT_ID")
  fi
  if [ -z "${CF_ZONE_ID:-}" ]; then
    missing+=("CF_ZONE_ID")
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    echo "ERROR: Missing required environment variables: ${missing[*]}"
    echo ""
    echo "Set them in your environment or in a .cloudflare file:"
    echo "  CF_API_TOKEN=<your-api-token>"
    echo "  CF_ACCOUNT_ID=<your-account-id>"
    echo "  CF_ZONE_ID=<your-zone-id>"
    exit 1
  fi
}

require_metadata() {
  if [ ! -f "$METADATA_FILE" ]; then
    echo "ERROR: No tunnel metadata found at ${METADATA_FILE}"
    echo "Run 'npm run cf -- setup <domain>' first."
    exit 1
  fi
}

require_jq() {
  if ! command -v jq &>/dev/null; then
    echo "ERROR: jq is not installed."
    echo "Install with: sudo apt install jq (or brew install jq)"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

cf_api() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"

  local args=(
    -s
    -X "$method"
    -H "Authorization: Bearer ${CF_API_TOKEN}"
    -H "Content-Type: application/json"
  )

  if [ -n "$data" ]; then
    args+=(-d "$data")
  fi

  curl "${args[@]}" "${CF_API_BASE}${endpoint}"
}

check_api_success() {
  local response="$1"
  local context="$2"

  local success
  success=$(echo "$response" | jq -r '.success')

  if [ "$success" != "true" ]; then
    local errors
    errors=$(echo "$response" | jq -r '.errors[] | "  - \(.code): \(.message)"')
    echo "ERROR: ${context} failed:"
    echo "$errors"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# setup
# ---------------------------------------------------------------------------

cmd_setup() {
  if [ $# -lt 1 ]; then
    echo "Usage: npm run cf -- setup <domain>"
    echo ""
    echo "Example: npm run cf -- setup rockpool.example.com"
    exit 1
  fi

  local domain="$1"

  require_env
  require_jq

  if [ -f "$METADATA_FILE" ]; then
    echo "ERROR: Tunnel metadata already exists at ${METADATA_FILE}"
    echo "Run 'npm run cf -- teardown' first to remove the existing tunnel."
    exit 1
  fi

  echo "=== Creating Cloudflare Tunnel ==="
  echo ""

  local tunnel_secret
  tunnel_secret=$(openssl rand -base64 32)

  echo "Creating tunnel '${TUNNEL_NAME}'..."
  local create_response
  create_response=$(cf_api POST "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel" \
    "{\"name\":\"${TUNNEL_NAME}\",\"tunnel_secret\":\"${tunnel_secret}\"}")
  check_api_success "$create_response" "Create tunnel"

  local tunnel_id
  tunnel_id=$(echo "$create_response" | jq -r '.result.id')
  local tunnel_token
  tunnel_token=$(echo "$create_response" | jq -r '.result.token')

  echo "  Tunnel ID: ${tunnel_id}"

  echo ""
  echo "Configuring ingress rules..."
  local config_payload
  config_payload=$(jq -n \
    --arg domain "$domain" \
    '{
      config: {
        ingress: [
          {hostname: $domain, service: "http://control-plane:7163"},
          {hostname: ("ide." + $domain), service: "http://caddy:8081"},
          {hostname: ("preview." + $domain), service: "http://caddy:8082"},
          {service: "http_status:404"}
        ]
      }
    }')

  local config_response
  config_response=$(cf_api PUT "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${tunnel_id}/configurations" "$config_payload")
  check_api_success "$config_response" "Configure tunnel ingress"
  echo "  Ingress configured for: ${domain}, ide.${domain}, preview.${domain}"

  echo ""
  echo "Creating DNS records..."
  local tunnel_cname="${tunnel_id}.cfargotunnel.com"
  local record_ids=()

  for hostname in "$domain" "ide.${domain}" "preview.${domain}"; do
    local dns_response
    dns_response=$(cf_api POST "/zones/${CF_ZONE_ID}/dns_records" \
      "{\"type\":\"CNAME\",\"name\":\"${hostname}\",\"content\":\"${tunnel_cname}\",\"proxied\":true,\"comment\":\"rockpool-tunnel\"}")
    check_api_success "$dns_response" "Create DNS record for ${hostname}"

    local record_id
    record_id=$(echo "$dns_response" | jq -r '.result.id')
    record_ids+=("$record_id")
    echo "  ${hostname} -> ${tunnel_cname} (record: ${record_id})"
  done

  echo ""
  echo "Saving tunnel metadata..."
  jq -n \
    --arg tunnel_id "$tunnel_id" \
    --arg domain "$domain" \
    --arg record_root "${record_ids[0]}" \
    --arg record_ide "${record_ids[1]}" \
    --arg record_preview "${record_ids[2]}" \
    '{
      tunnel_id: $tunnel_id,
      domain: $domain,
      dns_records: {
        root: $record_root,
        ide: $record_ide,
        preview: $record_preview
      }
    }' > "$METADATA_FILE"

  echo "$tunnel_token" > "$TOKEN_FILE"

  echo ""
  echo "=== Tunnel setup complete ==="
  echo ""
  echo "  Domain:    ${domain}"
  echo "  IDE:       ide.${domain}"
  echo "  Preview:   preview.${domain}"
  echo "  Token:     ${TOKEN_FILE}"
  echo "  Metadata:  ${METADATA_FILE}"
  echo ""
  echo "To start the tunnel, add TUNNEL_TOKEN to your env file:"
  echo ""
  echo "  TUNNEL_TOKEN=$(cat "$TOKEN_FILE")"
  echo ""
  echo "Then start the stack with the tunnel profile:"
  echo ""
  echo "  npm run start:tunnel"
}

# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

cmd_status() {
  require_env
  require_jq
  require_metadata

  local tunnel_id
  tunnel_id=$(jq -r '.tunnel_id' "$METADATA_FILE")
  local domain
  domain=$(jq -r '.domain' "$METADATA_FILE")

  echo "=== Tunnel Status ==="
  echo ""
  echo "  Domain:    ${domain}"
  echo "  Tunnel ID: ${tunnel_id}"
  echo ""

  local response
  response=$(cf_api GET "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${tunnel_id}")
  check_api_success "$response" "Get tunnel status"

  local status
  status=$(echo "$response" | jq -r '.result.status')
  local name
  name=$(echo "$response" | jq -r '.result.name')

  echo "  Name:      ${name}"
  echo "  Status:    ${status}"

  local connections
  connections=$(echo "$response" | jq -r '.result.connections // [] | length')
  echo "  Connectors: ${connections}"

  if [ "$connections" -gt 0 ]; then
    echo ""
    echo "  Connected from:"
    echo "$response" | jq -r '.result.connections[] | "    - \(.colo_name) (id: \(.id[0:8])..., origin: \(.origin_ip // "unknown"))"'
  fi
}

# ---------------------------------------------------------------------------
# teardown
# ---------------------------------------------------------------------------

cmd_teardown() {
  require_env
  require_jq
  require_metadata

  local tunnel_id
  tunnel_id=$(jq -r '.tunnel_id' "$METADATA_FILE")
  local domain
  domain=$(jq -r '.domain' "$METADATA_FILE")

  echo "=== Tearing down Cloudflare Tunnel ==="
  echo ""
  echo "  Tunnel: ${tunnel_id}"
  echo "  Domain: ${domain}"
  echo ""

  echo "Deleting DNS records..."
  for key in root ide preview; do
    local record_id
    record_id=$(jq -r ".dns_records.${key}" "$METADATA_FILE")

    if [ "$record_id" = "null" ] || [ -z "$record_id" ]; then
      echo "  Skipping ${key}: no record ID"
      continue
    fi

    local response
    response=$(cf_api DELETE "/zones/${CF_ZONE_ID}/dns_records/${record_id}")
    local success
    success=$(echo "$response" | jq -r '.success')

    if [ "$success" = "true" ]; then
      echo "  Deleted ${key} record: ${record_id}"
    else
      echo "  WARNING: Failed to delete ${key} record ${record_id} (may already be deleted)"
    fi
  done

  echo ""
  echo "Deleting tunnel configuration..."
  cf_api PUT "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${tunnel_id}/configurations" \
    '{"config":{"ingress":[{"service":"http_status:404"}]}}' > /dev/null

  echo "Deleting tunnel..."
  local delete_response
  delete_response=$(cf_api DELETE "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${tunnel_id}")
  local success
  success=$(echo "$delete_response" | jq -r '.success')

  if [ "$success" = "true" ]; then
    echo "  Tunnel deleted."
  else
    # Tunnel may need to be cleaned up (e.g., active connections)
    echo "  WARNING: Tunnel deletion returned errors. It may have active connections."
    echo "  Attempting force cleanup with cleanup_connections..."
    delete_response=$(cf_api DELETE "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${tunnel_id}?cascade=true")
    success=$(echo "$delete_response" | jq -r '.success')
    if [ "$success" = "true" ]; then
      echo "  Tunnel force-deleted."
    else
      echo "  ERROR: Could not delete tunnel. Check the Cloudflare dashboard."
      echo "$delete_response" | jq -r '.errors[]? | "    \(.code): \(.message)"'
    fi
  fi

  echo ""
  echo "Cleaning up local files..."
  rm -f "$METADATA_FILE" "$TOKEN_FILE"
  echo "  Removed ${METADATA_FILE}"
  echo "  Removed ${TOKEN_FILE}"

  echo ""
  echo "Teardown complete."
}

# ---------------------------------------------------------------------------
# token
# ---------------------------------------------------------------------------

cmd_token() {
  if [ ! -f "$TOKEN_FILE" ]; then
    echo "ERROR: No tunnel token found at ${TOKEN_FILE}"
    echo "Run 'npm run cf -- setup <domain>' first."
    exit 1
  fi

  cat "$TOKEN_FILE"
}

# ---------------------------------------------------------------------------
# dns
# ---------------------------------------------------------------------------

cmd_dns() {
  require_env
  require_jq

  echo "=== Rockpool Tunnel DNS Records ==="
  echo ""

  local response
  response=$(cf_api GET "/zones/${CF_ZONE_ID}/dns_records?type=CNAME&comment=rockpool-tunnel")
  check_api_success "$response" "List DNS records"

  local count
  count=$(echo "$response" | jq -r '.result | length')

  if [ "$count" -eq 0 ]; then
    echo "  No DNS records found with comment 'rockpool-tunnel'."
    exit 0
  fi

  echo "$response" | jq -r '.result[] | "  \(.name) -> \(.content) (id: \(.id), proxied: \(.proxied))"'
}

# ---------------------------------------------------------------------------
# dispatch
# ---------------------------------------------------------------------------

case "$COMMAND" in
  setup)    cmd_setup "$@" ;;
  status)   cmd_status "$@" ;;
  teardown) cmd_teardown "$@" ;;
  token)    cmd_token "$@" ;;
  dns)      cmd_dns "$@" ;;
  -h|--help) usage; exit 0 ;;
  *)
    echo "ERROR: Unknown command '${COMMAND}'"
    echo ""
    usage
    exit 1
    ;;
esac
