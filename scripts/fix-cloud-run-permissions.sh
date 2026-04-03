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
# IMPORTANT: Use --update-env-vars with || delimiter to avoid wiping Firebase env vars.
# The gcloud update creates a new revision that inherits from the current template,
# so we must never use --set-env-vars (which replaces ALL vars).
if [ -n "$RESEND_API_KEY" ]; then
  echo ""
  echo "Setting Resend API key on email functions..."
  EMAIL_SVCS="verifyparentemail verifyejmemail sendcontactrequest respondtorequest resubmitappointment sendreminders submitverification modifyappointment cancelappointment deleteappointment deleteuser"
  for svc in $EMAIL_SVCS; do
    # Check if RESEND_API_KEY is already set correctly (avoid creating unnecessary revisions)
    current=$(gcloud run services describe "$svc" --region=$REGION --project=$PROJECT --format="value(spec.template.spec.containers[0].env)" 2>/dev/null)
    if echo "$current" | grep -q "RESEND_API_KEY.*$RESEND_API_KEY"; then
      echo "  ✔ $svc (already set)"
    else
      gcloud run services update "$svc" \
        --region=$REGION --project=$PROJECT \
        --update-env-vars="RESEND_API_KEY=$RESEND_API_KEY" \
        --quiet 2>/dev/null && echo "  ✔ $svc" || echo "  ✗ $svc (failed)"
    fi
  done
fi

echo ""
echo "Done!"
