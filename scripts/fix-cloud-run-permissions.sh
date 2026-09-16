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

# Resend API key: NOT set here any more (issue #497).
#
# This used to re-apply RESEND_API_KEY to a hard-coded list of 11 services.
# Every email path added after that list was written never got the key, so
# getResend() returned null and the mail was dropped behind a [NO-RESEND] log
# line — 109 of 120 services were missing it when this was found. A list kept
# in a shell script cannot track a call graph that keeps growing.
#
# The key is now a Firebase Functions secret param
# (packages/shared-functions/src/config/secrets.ts), declared by every function
# that can reach the mailer and bound automatically on every deploy. There is
# nothing left to re-apply afterwards.
#
# That also sidesteps the second half of #497: the gcf-artifacts cleanup policy
# deletes the tagged build image after 24h, so an out-of-band
# `gcloud run services update` fails with `Image …:version_1 not found` outside
# that window. Deploy-time binding has no such window.
#
# packages/shared-functions/src/config/__tests__/resendSecretBinding.test.ts
# fails the build if a mailer-reaching function stops declaring the param, and
# also asserts this block never comes back.

echo ""
echo "Done!"
