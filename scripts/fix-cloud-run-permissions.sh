#!/bin/bash
# Fix Cloud Run IAM permissions after Firebase deploy.
# Firebase deploys can reset the allUsers invoker binding.

PROJECT=sync-sit
REGION=europe-west1
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source deploy env if available
if [ -f "$SCRIPT_DIR/../.env.deploy" ]; then
  source "$SCRIPT_DIR/../.env.deploy"
fi

echo "Fixing Cloud Run permissions for all functions..."

SERVICES=$(gcloud run services list --region=$REGION --project=$PROJECT --format="value(name)" 2>/dev/null)

for svc in $SERVICES; do
  gcloud run services add-iam-policy-binding "$svc" \
    --region=$REGION --project=$PROJECT \
    --member="allUsers" --role="roles/run.invoker" \
    --quiet 2>/dev/null | grep -q "allUsers" && echo "  ✔ $svc" || echo "  ✗ $svc (failed)"
done

# Re-set Resend API key on email functions
if [ -n "$RESEND_API_KEY" ]; then
  echo ""
  echo "Setting Resend API key on email functions..."
  for svc in verifyparentemail verifyejmemail; do
    gcloud run services update "$svc" \
      --region=$REGION --project=$PROJECT \
      --set-env-vars="RESEND_API_KEY=$RESEND_API_KEY" \
      --quiet 2>/dev/null | tail -1
  done
fi

echo ""
echo "Done!"
