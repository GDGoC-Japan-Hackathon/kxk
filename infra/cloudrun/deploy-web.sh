#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PATH="/usr/local/share/google-cloud-sdk/bin:/opt/homebrew/share/google-cloud-sdk/bin:${PATH}"
PROJECT_ID="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GCP_REGION:-${REGION:-us-central1}}"
SERVICE_NAME="${WEB_SERVICE_NAME:-worldlens-web}"
API_SERVICE_NAME="${API_SERVICE_NAME:-worldlens-api}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Set GCP_PROJECT or run: gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi

if [[ -f "${ROOT_DIR}/apps/web/.env.local" ]]; then
  set -a
  source "${ROOT_DIR}/apps/web/.env.local"
  set
fi

API_BASE_URL="${API_BASE_URL:-${NEXT_PUBLIC_API_URL:-}}"
if [[ -z "${API_BASE_URL}" ]]; then
  API_BASE_URL="$(gcloud run services describe "${API_SERVICE_NAME}" --project "${PROJECT_ID}" --region "${REGION}" --format 'value(status.url)')"
fi

if [[ -z "${API_BASE_URL}" ]]; then
  echo "API_BASE_URL is empty. Deploy the API first." >&2
  exit 1
fi

ENV_VARS=(
  "HOSTNAME=0.0.0.0"
  "API_BASE_URL=${API_BASE_URL}"
  "NEXT_PUBLIC_API_URL=${API_BASE_URL}"
)

for name in NEXT_PUBLIC_CESIUM_ION_TOKEN OPENWEATHER_API_KEY NEWS_API_KEY OPENAI_API_KEY OPENAI_MODEL AISSTREAM_API_KEY OPENSKY_USERNAME OPENSKY_PASSWORD; do
  value="${!name:-}"
  if [[ -n "${value}" ]]; then
    ENV_VARS+=("${name}=${value}")
  fi
done

env_csv="$(IFS=,; echo "${ENV_VARS[*]}")"

gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --source "${ROOT_DIR}/apps/web" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "${env_csv}" \
  --quiet

gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format 'value(status.url)'
