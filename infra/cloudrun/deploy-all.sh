#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

api_url="$("${ROOT_DIR}/infra/cloudrun/deploy-api.sh" | tail -n 1)"
echo "API deployed: ${api_url}"

API_BASE_URL="${api_url}" "${ROOT_DIR}/infra/cloudrun/deploy-web.sh"
