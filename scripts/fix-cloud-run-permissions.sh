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

# createCustomToken (cross-app handoff) requires the runtime service account
# to sign blobs as itself (iam.serviceAccounts.signBlob) — not included in
# editor/firebase.admin, and the emulator doesn't enforce it, so a missing
# binding only fails in prod. Discover each service's actual SA rather than
# assuming the default; an empty serviceAccountName means the default compute
# SA. Idempotent: re-granting is a no-op.
echo ""
echo "Granting Token Creator (signBlob) to runtime service accounts..."
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format="value(projectNumber)")
DEFAULT_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
RUNTIME_SAS=$(
  {
    for svc in $SERVICES; do
      gcloud run services describe "$svc" --region=$REGION --project=$PROJECT \
        --format="value(spec.template.spec.serviceAccountName)" 2>/dev/null
    done
    echo "$DEFAULT_SA"
  } | grep -v '^$' | sort -u
)
for sa in $RUNTIME_SAS; do
  gcloud iam service-accounts add-iam-policy-binding "$sa" \
    --project=$PROJECT \
    --member="serviceAccount:$sa" \
    --role="roles/iam.serviceAccountTokenCreator" \
    --quiet >/dev/null 2>&1 && echo "  ✔ $sa" || echo "  ✗ $sa (failed)"
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
