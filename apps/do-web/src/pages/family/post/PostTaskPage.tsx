import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { getParentProfile } from '@ejm/shared-core';
import { Button, StepIndicator, TopNav, useToast } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import {
  EMPTY_DRAFT,
  POST_STEPS,
  buildPostTaskPayload,
  isStepValid,
  type TaskDraft,
} from './postTaskDraft';
import {
  StepAdultPresent,
  StepBudget,
  StepCategory,
  StepSubCategory,
  StepToolsTransport,
} from './steps';
import { StepTiming } from './StepTiming';
import { StepDescribe } from './StepDescribe';
import { StepPhotos } from './StepPhotos';
import { usePhotoUploads } from './usePhotoUploads';
import { StepReview, type PublishErrorKey } from './StepReview';
import { AddressFixPanel } from './AddressFixPanel';

/**
 * The post-a-task wizard (plan §9.1 bullet 1), §9.1's step order verbatim:
 * category → sub-category → timing → title+description with considerations
 * → photos → adult-present → tools/transport → budget → review+publish.
 * Client-side gating runs the same do-core validators doPostTask runs
 * (postTaskDraft.isStepValid), so the server's invalid-argument branch is
 * pre-empted; the review step maps the callable's machine-readable refusals
 * (address_required → the decision-17 in-wizard address panel, task_cap,
 * verification) to their own copy.
 */
export function PostTaskPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { firebaseUser, userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId ?? null;

  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<PublishErrorKey>(null);
  const [addressFix, setAddressFix] = useState(false);
  // Why the wizard bounced back to the photos step (photo_not_ready): the
  // jump must be explained on arrival, not silent (PR #331 round 1).
  const [photosNotice, setPhotosNotice] = useState<string | null>(null);

  // The §7.4 photo pipeline lives HERE, not in StepPhotos (PR #331 round
  // 3): the wizard renders one step at a time, so a step-local hook died on
  // Back mid-upload and the resolving uploadBytes stranded the tile in a
  // permanent 'uploading'. Page-hosted, uploads and polls keep running
  // while the parent visits other steps; the cleanup fires only when the
  // wizard itself unmounts — where the draft dies with it anyway.
  const photoActions = usePhotoUploads({
    uid: firebaseUser?.uid ?? null,
    photos: draft.photos,
    onChange: (mutate) => setDraft((d) => ({ ...d, photos: mutate(d.photos) })),
  });

  const step = POST_STEPS[stepIndex];
  const update = (changes: Partial<TaskDraft>) => setDraft((d) => ({ ...d, ...changes }));

  const handleBack = () => {
    if (addressFix) {
      setAddressFix(false);
      return;
    }
    if (stepIndex === 0) {
      navigate('/family/tasks');
      return;
    }
    setStepIndex(stepIndex - 1);
  };

  const handlePublish = async () => {
    if (!firebaseUser) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const postTask = httpsCallable<Record<string, unknown>, { taskId: string }>(
        functions,
        'doPostTask',
      );
      const res = await postTask(buildPostTaskPayload(draft, firebaseUser.uid));
      toast(t('family.post.published'));
      navigate(`/family/tasks/${res.data.taskId}`, { replace: true });
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code ?? '';
      const reason = (err as { details?: { reason?: string } } | null)?.details?.reason;
      if (reason === 'address_required') {
        // Decision 17: route the parent to complete their address —
        // in-wizard, so the draft survives the detour.
        setAddressFix(true);
      } else if (reason === 'task_cap') {
        setPublishError('cap');
      } else if (reason === 'photo_not_ready') {
        // The stripper is still working on a photo doPostTask checked —
        // send the parent back to the photos step, where the pending state
        // and its retry live, WITH the reason for the jump.
        setPhotosNotice(t('family.post.photoNotReadyNotice'));
        setStepIndex(POST_STEPS.indexOf('photos'));
      } else if (code.endsWith('permission-denied')) {
        // loadVerifiedFamilyCaller emits NO details.reason and throws this
        // code for three distinct refusals (account not active / not a
        // parent / family not verified), so the copy states the honest
        // UNION rather than asserting verification specifically
        // (PR #331 round 3).
        setPublishError('denied');
      } else {
        setPublishError('generic');
      }
    } finally {
      setPublishing(false);
    }
  };

  const stepBody = () => {
    switch (step) {
      case 'category':
        return <StepCategory draft={draft} update={update} />;
      case 'subCategory':
        return <StepSubCategory draft={draft} update={update} />;
      case 'timing':
        return <StepTiming draft={draft} update={update} />;
      case 'describe':
        return <StepDescribe draft={draft} update={update} />;
      case 'photos':
        return <StepPhotos draft={draft} update={update} actions={photoActions} pageNotice={photosNotice} />;
      case 'adultPresent':
        return <StepAdultPresent draft={draft} update={update} />;
      case 'toolsTransport':
        return <StepToolsTransport draft={draft} update={update} />;
      case 'budget':
        return <StepBudget draft={draft} update={update} />;
      case 'review':
        return addressFix && familyId ? (
          <AddressFixPanel
            familyId={familyId}
            onSaved={() => {
              setAddressFix(false);
              toast(t('family.post.addressSaved'));
            }}
            onBack={() => setAddressFix(false)}
          />
        ) : (
          <StepReview
            draft={draft}
            publishing={publishing}
            publishError={publishError}
            onPublish={handlePublish}
          />
        );
    }
  };

  const stepTitleKey = {
    category: 'family.post.stepCategory',
    subCategory: 'family.post.stepSubCategory',
    timing: 'family.post.stepTiming',
    describe: 'family.post.stepDescribe',
    photos: 'family.post.stepPhotos',
    adultPresent: 'family.post.stepAdultPresent',
    toolsTransport: 'family.post.stepToolsTransport',
    budget: 'family.post.stepBudget',
    review: 'family.post.stepReview',
  }[step];

  return (
    <div>
      <TopNav title={t('family.post.title')} onBack={handleBack} />
      <StepIndicator totalSteps={POST_STEPS.length} currentStep={stepIndex} />
      <div className="px-6 pt-4 pb-8">
        <h2 className="mb-4 text-lg font-bold text-gray-950">{t(stepTitleKey)}</h2>
        {stepBody()}
        {step !== 'review' && (
          <div className="mt-6">
            <Button
              onClick={() => {
                // Leaving the photos step forward clears the bounce-back
                // notice — every thumbnail is ready again (isStepValid).
                if (step === 'photos') setPhotosNotice(null);
                setStepIndex(stepIndex + 1);
              }}
              disabled={!isStepValid(step, draft)}
            >
              {t('family.post.next')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
