#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_ID="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GCP_REGION:-${REGION:-us-central1}}"
SERVICE_NAME="${API_SERVICE_NAME:-worldlens-api}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Set GCP_PROJECT or run: gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi

if [[ -f "${ROOT_DIR}/apps/web/.env.local" ]]; then
  set -a
  source "${ROOT_DIR}/apps/web/.env.local"
  set +a
fi

ENV_VARS=()

for name in API_SKIP_STARTUP WORLDLENS_AUTH_SECRET OPENWEATHER_API_KEY AISSTREAM_API_KEY OPENSKY_USERNAME OPENSKY_PASSWORD NEWS_API_KEY OPENAI_API_KEY OPENAI_MODEL TWELVEDATA_API_KEY FINNHUB_API_KEY POLYGON_API_KEY ALPHAVANTAGE_API_KEY FRED_API_KEY; do
  value="${!name:-}"
  if [[ -n "${value}" ]]; then
    ENV_VARS+=("${name}=${value}")
  fi
done

env_csv="$(IFS=,; echo "${ENV_VARS[*]}")"

gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --source "${ROOT_DIR}/apps/api" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "${env_csv}" \
  --quiet

gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format 'value(status.url)'
