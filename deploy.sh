#!/usr/bin/env bash
# Deploy route-to-office to Cloud Run. Edit the variables at the top and run:
#   ./deploy.sh
#
# Requires: gcloud CLI logged in, correct project set with `gcloud config set project ...`.

set -euo pipefail

PROJECT_ID="pro-creek-445104-d2"
REGION="asia-southeast1"
ENV="staging"                                 # staging | prod
SERVICE="route-to-office-${ENV}"
SECRET_NAME="route-to-office-${ENV}"
RUNTIME_SA="route-to-office@${PROJECT_ID}.iam.gserviceaccount.com"
FRONTEND_ORIGINS="http://localhost:5173"      # comma-separated, no spaces

echo "==> Deploying $SERVICE to $REGION using $RUNTIME_SA"

gcloud run deploy "$SERVICE" \
  --source . \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --service-account="$RUNTIME_SA" \
  --allow-unauthenticated \
  --min-instances=1 \
  --max-instances=1 \
  --cpu=1 \
  --memory=512Mi \
  --port=8080 \
  --timeout=30s \
  --set-env-vars="USE_GCP_SECRETS=true,GCP_PROJECT_ID=${PROJECT_ID},GCP_SECRET_NAME=${SECRET_NAME},TZ=Asia/Bangkok,FRONTEND_ORIGINS=${FRONTEND_ORIGINS}"

echo ""
echo "==> Deployed. Service URL:"
gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)'
