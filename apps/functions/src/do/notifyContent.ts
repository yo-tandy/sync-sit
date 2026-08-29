import { DO_APP_URL, escapeHtml } from '@ejm/shared-functions/config/email.js';

/**
 * sync-do notification copy, EN + FR (plan §10, §13 PR9) — the nine
 * task/offer types. PURE builders: no firebase imports, so the copy is
 * unit-testable in isolation (the send plumbing lives in notify.ts).
 *
 * Conventions, inherited from the platform (issue #188 / #168 Phase 0):
 * - HTML bodies escape every user/family-controlled string (task titles,
 *   first names, family names) via escapeHtml;
 * - email SUBJECT lines stay raw — RFC 5322 headers are never HTML-decoded;
 * - push/in-app title+body are plain-text contexts: raw;
 * - every CTA builds on DO_APP_URL — the live web.app host, never
 *   sync-do.com (§10 / issue #156).
 *
 * Language: per-recipient from the user doc's `language` field ('en'|'fr',
 * shared-core LANGUAGES) — resolved by the caller via resolveDoLang.
 */

export type DoLang = 'en' | 'fr';

export function resolveDoLang(language: unknown): DoLang {
  return language === 'fr' ? 'fr' : 'en';
}

export interface DoNotificationContent {
  /** Email subject (raw — RFC 5322 header context). */
  subject: string;
  /** Email HTML body fragment (user strings escaped). */
  emailBody: string;
  /** In-app / push title (plain text). */
  title: string;
  /** In-app / push body (plain text). */
  body: string;
}

/** The seven §4.3 category labels, EN+FR — mirrors do-web's i18n
 *  `categories` table (functions cannot import app i18n). */
export const DO_CATEGORY_LABELS: Record<DoLang, Record<string, string>> = {
  en: {
    green_thumb: 'Green thumb',
    boxes: 'Boxes & moving',
    ikea: 'Ikea assembly',
    party: 'Party help',
    it: 'IT help',
    errands: 'Errands',
    pet_house: 'Pet & house-sitting',
  },
  fr: {
    green_thumb: 'Main verte',
    boxes: 'Cartons & déménagement',
    ikea: 'Montage Ikea',
    party: 'Aide fête',
    it: 'Aide informatique',
    errands: 'Courses',
    pet_house: "Garde d'animaux & de maison",
  },
};

export function categoryLabel(lang: DoLang, category: string): string {
  return DO_CATEGORY_LABELS[lang][category] ?? category;
}

/** "€25" / "€12/h" (EN) — "25 €" / "12 €/h" (FR). */
export function formatPrice(
  lang: DoLang,
  price: number,
  priceBasis: 'flat' | 'hourly',
): string {
  const suffix = priceBasis === 'hourly' ? '/h' : '';
  return lang === 'fr' ? `${price} €${suffix}` : `€${price}${suffix}`;
}

function cta(href: string, label: string): string {
  return `<p style="margin-top: 16px;"><a href="${href}" style="background: #0d8204; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">${label}</a></p>`;
}

const FAMILY_TASK_URL = (taskId: string) => `${DO_APP_URL}/family/tasks/${taskId}`;
const DOER_TASK_URL = (taskId: string) => `${DO_APP_URL}/tasks/${taskId}`;
const MY_OFFERS_URL = `${DO_APP_URL}/offers`;
const MY_WORK_URL = `${DO_APP_URL}/work`;
const BOARD_URL = `${DO_APP_URL}/home`;

// ── task_offer_received — to the hiring family (submit; guardian approval
//    making a gated offer visible rides the same builder) ──────────────────

export function buildTaskOfferReceived(
  lang: DoLang,
  p: {
    doerFirstName: string;
    taskTitle: string;
    taskId: string;
    price: number;
    priceBasis: 'flat' | 'hourly';
  },
): DoNotificationContent {
  const priceStr = formatPrice(lang, p.price, p.priceBasis);
  if (lang === 'fr') {
    return {
      subject: `Nouvelle offre sur « ${p.taskTitle} »`,
      emailBody: `
        <p><strong>${escapeHtml(p.doerFirstName)}</strong> propose ${escapeHtml(priceStr)} pour votre tâche « ${escapeHtml(p.taskTitle)} ».</p>
        <p>Comparez les offres reçues et choisissez qui vous aide.</p>
        ${cta(FAMILY_TASK_URL(p.taskId), "Voir l'offre")}
      `,
      title: 'Nouvelle offre reçue',
      body: `${p.doerFirstName} propose ${priceStr} pour « ${p.taskTitle} ».`,
    };
  }
  return {
    subject: `New offer on "${p.taskTitle}"`,
    emailBody: `
      <p><strong>${escapeHtml(p.doerFirstName)}</strong> offered ${escapeHtml(priceStr)} on your task "${escapeHtml(p.taskTitle)}".</p>
      <p>Compare the offers you've received and pick who helps you.</p>
      ${cta(FAMILY_TASK_URL(p.taskId), 'View offer')}
    `,
    title: 'New offer received',
    body: `${p.doerFirstName} offered ${priceStr} on "${p.taskTitle}".`,
  };
}

// ── task_guardian_approval — both halves of the §6.2 consent loop:
//    'requested' goes to the supervising parent when a flagged offer lands
//    in pending_guardian; 'approved'/'denied' go to the STUDENT when the
//    parent decides (supervision is transparent — the
//    notifyChildOfGuardianAction shape). The hiring family is NEVER a
//    recipient of any of these (§6.2 invisibility). ───────────────────────

export function buildGuardianApprovalRequested(
  lang: DoLang,
  p: { childFirstName: string; taskTitle: string },
): DoNotificationContent {
  // No deep CTA: the §9.3 approval surface is the supervised-child view
  // served by the guardian callables, not a do-web route — the branded
  // footer's app link is the entry point until that surface deep-links.
  if (lang === 'fr') {
    return {
      subject: `${p.childFirstName} souhaite répondre à une tâche — votre accord est requis`,
      emailBody: `
        <p><strong>${escapeHtml(p.childFirstName)}</strong> souhaite faire une offre sur la tâche « ${escapeHtml(p.taskTitle)} », qui nécessite l'accord d'un parent.</p>
        <p>La famille ne verra l'offre qu'après votre approbation.</p>
      `,
      title: 'Accord parental requis',
      body: `${p.childFirstName} souhaite répondre à « ${p.taskTitle} » — votre accord est requis.`,
    };
  }
  return {
    subject: `${p.childFirstName} wants to take a task — your approval is needed`,
    emailBody: `
      <p><strong>${escapeHtml(p.childFirstName)}</strong> wants to offer on the task "${escapeHtml(p.taskTitle)}", which needs a parent's approval.</p>
      <p>The posting family will only see the offer once you approve it.</p>
    `,
    title: 'Parent approval needed',
    body: `${p.childFirstName} wants to offer on "${p.taskTitle}" — your approval is needed.`,
  };
}

export function buildGuardianDecisionForChild(
  lang: DoLang,
  p: { decision: 'approved' | 'denied'; taskTitle: string; taskId: string },
): DoNotificationContent {
  const approved = p.decision === 'approved';
  if (lang === 'fr') {
    return {
      subject: approved
        ? `Votre offre sur « ${p.taskTitle} » a été approuvée par un parent`
        : `Un parent a retiré votre offre sur « ${p.taskTitle} »`,
      emailBody: approved
        ? `
        <p>Un parent de votre famille a approuvé votre offre sur « ${escapeHtml(p.taskTitle)} ».</p>
        <p>La famille peut maintenant la voir et vous répondre.</p>
        ${cta(MY_OFFERS_URL, 'Voir mes offres')}
      `
        : `
        <p>Un parent de votre famille n'a pas approuvé votre offre sur « ${escapeHtml(p.taskTitle)} » — elle a été retirée.</p>
        <p>La famille ne l'a jamais vue. Parlez-en avec vos parents si vous avez des questions.</p>
        ${cta(MY_OFFERS_URL, 'Voir mes offres')}
      `,
      title: 'Un parent de votre famille a agi sur votre compte',
      body: approved
        ? `Votre offre sur « ${p.taskTitle} » a été approuvée — la famille peut maintenant la voir.`
        : `Votre offre sur « ${p.taskTitle} » a été retirée par un parent.`,
    };
  }
  return {
    subject: approved
      ? `Your offer on "${p.taskTitle}" was approved by a parent`
      : `A parent withdrew your offer on "${p.taskTitle}"`,
    emailBody: approved
      ? `
      <p>A parent of your family approved your offer on "${escapeHtml(p.taskTitle)}".</p>
      <p>The family can now see it and respond.</p>
      ${cta(MY_OFFERS_URL, 'View my offers')}
    `
      : `
      <p>A parent of your family did not approve your offer on "${escapeHtml(p.taskTitle)}" — it has been withdrawn.</p>
      <p>The family never saw it. Talk to your parents if you have questions.</p>
      ${cta(MY_OFFERS_URL, 'View my offers')}
    `,
    title: 'A parent of your family acted on your account',
    body: approved
      ? `Your offer on "${p.taskTitle}" was approved — the family can now see it.`
      : `Your offer on "${p.taskTitle}" was withdrawn by a parent.`,
  };
}

// ── task_offer_accepted — to the winning student ───────────────────────────

export function buildTaskOfferAccepted(
  lang: DoLang,
  p: { familyName: string; taskTitle: string; taskId: string; agreedPrice: number; priceBasis: 'flat' | 'hourly' },
): DoNotificationContent {
  const priceStr = formatPrice(lang, p.agreedPrice, p.priceBasis);
  if (lang === 'fr') {
    return {
      subject: `Votre offre sur « ${p.taskTitle} » a été acceptée !`,
      emailBody: `
        <p>La famille <strong>${escapeHtml(p.familyName)}</strong> a accepté votre offre (${escapeHtml(priceStr)}) pour « ${escapeHtml(p.taskTitle)} ».</p>
        <p>Vous pouvez maintenant voir leurs coordonnées et convenir des détails.</p>
        ${cta(MY_WORK_URL, 'Voir ma mission')}
      `,
      title: 'Offre acceptée !',
      body: `${p.familyName} a accepté votre offre (${priceStr}) pour « ${p.taskTitle} ».`,
    };
  }
  return {
    subject: `Your offer on "${p.taskTitle}" was accepted!`,
    emailBody: `
      <p>The <strong>${escapeHtml(p.familyName)}</strong> family accepted your offer (${escapeHtml(priceStr)}) for "${escapeHtml(p.taskTitle)}".</p>
      <p>You can now see their contact details and agree the specifics.</p>
      ${cta(MY_WORK_URL, 'View my assignment')}
    `,
    title: 'Offer accepted!',
    body: `${p.familyName} accepted your offer (${priceStr}) for "${p.taskTitle}".`,
  };
}

// ── task_assigned — to the winner's supervising parents (guardian-if-linked
//    at acceptance; supervision is transparent, §6.2) ──────────────────────

export function buildTaskAssignedGuardian(
  lang: DoLang,
  p: { childFirstName: string; familyName: string; taskTitle: string; agreedPrice: number; priceBasis: 'flat' | 'hourly' },
): DoNotificationContent {
  const priceStr = formatPrice(lang, p.agreedPrice, p.priceBasis);
  if (lang === 'fr') {
    return {
      subject: `${p.childFirstName} a été choisi(e) pour « ${p.taskTitle} »`,
      emailBody: `
        <p>La famille <strong>${escapeHtml(p.familyName)}</strong> a accepté l'offre de <strong>${escapeHtml(p.childFirstName)}</strong> (${escapeHtml(priceStr)}) pour la tâche « ${escapeHtml(p.taskTitle)} ».</p>
      `,
      title: 'Un parent de votre famille est informé',
      body: `${p.childFirstName} a été choisi(e) par ${p.familyName} pour « ${p.taskTitle} » (${priceStr}).`,
    };
  }
  return {
    subject: `${p.childFirstName} was picked for "${p.taskTitle}"`,
    emailBody: `
      <p>The <strong>${escapeHtml(p.familyName)}</strong> family accepted <strong>${escapeHtml(p.childFirstName)}</strong>'s offer (${escapeHtml(priceStr)}) for the task "${escapeHtml(p.taskTitle)}".</p>
    `,
    title: 'Your child took a task',
    body: `${p.childFirstName} was picked by ${p.familyName} for "${p.taskTitle}" (${priceStr}).`,
  };
}

// ── task_offer_declined — to a student whose offer left the running ────────

export function buildTaskOfferDeclined(
  lang: DoLang,
  p: { taskTitle: string; reason: 'family_declined' | 'sibling_accepted' },
): DoNotificationContent {
  const choseAnother = p.reason === 'sibling_accepted';
  if (lang === 'fr') {
    return {
      subject: `Votre offre sur « ${p.taskTitle} » n'a pas été retenue`,
      emailBody: choseAnother
        ? `
        <p>La famille a choisi un autre étudiant pour « ${escapeHtml(p.taskTitle)} ».</p>
        <p>D'autres tâches vous attendent sur le tableau.</p>
        ${cta(BOARD_URL, 'Voir le tableau')}
      `
        : `
        <p>La famille a décliné votre offre sur « ${escapeHtml(p.taskTitle)} ».</p>
        <p>Vous pouvez refaire une offre sur cette tâche, ou en trouver une autre sur le tableau.</p>
        ${cta(BOARD_URL, 'Voir le tableau')}
      `,
      title: 'Offre non retenue',
      body: choseAnother
        ? `La famille a choisi un autre étudiant pour « ${p.taskTitle} ».`
        : `La famille a décliné votre offre sur « ${p.taskTitle} ».`,
    };
  }
  return {
    subject: `Your offer on "${p.taskTitle}" wasn't picked`,
    emailBody: choseAnother
      ? `
      <p>The family picked another student for "${escapeHtml(p.taskTitle)}".</p>
      <p>More tasks are waiting on the board.</p>
      ${cta(BOARD_URL, 'Browse the board')}
    `
      : `
      <p>The family declined your offer on "${escapeHtml(p.taskTitle)}".</p>
      <p>You can offer again on this task, or find another one on the board.</p>
      ${cta(BOARD_URL, 'Browse the board')}
    `,
    title: 'Offer not picked',
    body: choseAnother
      ? `The family picked another student for "${p.taskTitle}".`
      : `The family declined your offer on "${p.taskTitle}".`,
  };
}

// ── task_cancelled — three audiences ───────────────────────────────────────

export function buildTaskCancelledForDoer(
  lang: DoLang,
  p: { taskTitle: string; assigned: boolean },
): DoNotificationContent {
  if (lang === 'fr') {
    return {
      subject: `La tâche « ${p.taskTitle} » a été annulée`,
      emailBody: p.assigned
        ? `
        <p>La famille a annulé la tâche « ${escapeHtml(p.taskTitle)} » qui vous était confiée.</p>
        <p>Vous pouvez encore contacter la famille pendant quelques jours pour organiser la suite.</p>
        ${cta(MY_WORK_URL, 'Voir mes missions')}
      `
        : `
        <p>La tâche « ${escapeHtml(p.taskTitle)} », sur laquelle vous aviez fait une offre, a été annulée par la famille.</p>
        ${cta(BOARD_URL, 'Voir le tableau')}
      `,
      title: 'Tâche annulée',
      body: `La tâche « ${p.taskTitle} » a été annulée par la famille.`,
    };
  }
  return {
    subject: `The task "${p.taskTitle}" was cancelled`,
    emailBody: p.assigned
      ? `
      <p>The family cancelled the task "${escapeHtml(p.taskTitle)}" you were assigned to.</p>
      <p>You can still reach the family for a few days to sort out the aftermath.</p>
      ${cta(MY_WORK_URL, 'View my assignments')}
    `
      : `
      <p>The task "${escapeHtml(p.taskTitle)}", which you had offered on, was cancelled by the family.</p>
      ${cta(BOARD_URL, 'Browse the board')}
    `,
    title: 'Task cancelled',
    body: `The task "${p.taskTitle}" was cancelled by the family.`,
  };
}

export function buildTaskCancelledForFamily(
  lang: DoLang,
  p: { doerFirstName: string; taskTitle: string; taskId: string },
): DoNotificationContent {
  if (lang === 'fr') {
    return {
      subject: `${p.doerFirstName} a annulé « ${p.taskTitle} »`,
      emailBody: `
        <p><strong>${escapeHtml(p.doerFirstName)}</strong> a annulé la tâche « ${escapeHtml(p.taskTitle)} » qui lui était confiée.</p>
        <p>Vous pouvez republier la tâche pour recevoir de nouvelles offres.</p>
        ${cta(FAMILY_TASK_URL(p.taskId), 'Voir la tâche')}
      `,
      title: 'Mission annulée',
      body: `${p.doerFirstName} a annulé « ${p.taskTitle} ».`,
    };
  }
  return {
    subject: `${p.doerFirstName} cancelled "${p.taskTitle}"`,
    emailBody: `
      <p><strong>${escapeHtml(p.doerFirstName)}</strong> cancelled the task "${escapeHtml(p.taskTitle)}" they were assigned to.</p>
      <p>You can post the task again to receive new offers.</p>
      ${cta(FAMILY_TASK_URL(p.taskId), 'View task')}
    `,
    title: 'Assignment cancelled',
    body: `${p.doerFirstName} cancelled "${p.taskTitle}".`,
  };
}

// ── task_updated — to students with live offers on an edited task ──────────

export function buildTaskUpdated(
  lang: DoLang,
  p: { taskTitle: string; taskId: string },
): DoNotificationContent {
  if (lang === 'fr') {
    return {
      subject: `La tâche « ${p.taskTitle} » a été modifiée`,
      emailBody: `
        <p>La famille a modifié la tâche « ${escapeHtml(p.taskTitle)} », sur laquelle vous avez une offre en cours.</p>
        <p>Vérifiez que votre offre correspond toujours aux nouvelles conditions.</p>
        ${cta(DOER_TASK_URL(p.taskId), 'Voir la tâche')}
      `,
      title: 'Tâche modifiée',
      body: `« ${p.taskTitle} » a été modifiée — vérifiez votre offre.`,
    };
  }
  return {
    subject: `The task "${p.taskTitle}" was updated`,
    emailBody: `
      <p>The family edited the task "${escapeHtml(p.taskTitle)}", which you have a live offer on.</p>
      <p>Check that your offer still matches the new terms.</p>
      ${cta(DOER_TASK_URL(p.taskId), 'View task')}
    `,
    title: 'Task updated',
    body: `"${p.taskTitle}" was updated — review your offer.`,
  };
}

// ── task_marked_done — both directions of §6.5 ─────────────────────────────

export function buildTaskMarkedDoneForFamily(
  lang: DoLang,
  p: { doerFirstName: string; taskTitle: string; taskId: string },
): DoNotificationContent {
  if (lang === 'fr') {
    return {
      subject: `${p.doerFirstName} a terminé « ${p.taskTitle} »`,
      emailBody: `
        <p><strong>${escapeHtml(p.doerFirstName)}</strong> a marqué la tâche « ${escapeHtml(p.taskTitle)} » comme terminée.</p>
        <p>Confirmez pour clore la tâche — sans confirmation, elle sera close automatiquement sous 7 jours.</p>
        ${cta(FAMILY_TASK_URL(p.taskId), 'Confirmer')}
      `,
      title: 'Tâche terminée ?',
      body: `${p.doerFirstName} a marqué « ${p.taskTitle} » comme terminée — confirmez pour clore.`,
    };
  }
  return {
    subject: `${p.doerFirstName} finished "${p.taskTitle}"`,
    emailBody: `
      <p><strong>${escapeHtml(p.doerFirstName)}</strong> marked the task "${escapeHtml(p.taskTitle)}" as done.</p>
      <p>Confirm to complete the task — without confirmation it completes automatically in 7 days.</p>
      ${cta(FAMILY_TASK_URL(p.taskId), 'Confirm')}
    `,
    title: 'Task done?',
    body: `${p.doerFirstName} marked "${p.taskTitle}" as done — confirm to complete.`,
  };
}

export function buildTaskCompletedForDoer(
  lang: DoLang,
  p: { familyName: string; taskTitle: string },
): DoNotificationContent {
  if (lang === 'fr') {
    return {
      subject: `« ${p.taskTitle} » est terminée — merci !`,
      emailBody: `
        <p>La famille <strong>${escapeHtml(p.familyName)}</strong> a confirmé que la tâche « ${escapeHtml(p.taskTitle)} » est terminée.</p>
        <p>Bien joué !</p>
        ${cta(MY_WORK_URL, 'Voir mes missions')}
      `,
      title: 'Tâche terminée',
      body: `${p.familyName} a confirmé que « ${p.taskTitle} » est terminée.`,
    };
  }
  return {
    subject: `"${p.taskTitle}" is complete — nice work!`,
    emailBody: `
      <p>The <strong>${escapeHtml(p.familyName)}</strong> family confirmed the task "${escapeHtml(p.taskTitle)}" is complete.</p>
      <p>Well done!</p>
      ${cta(MY_WORK_URL, 'View my assignments')}
    `,
    title: 'Task complete',
    body: `${p.familyName} confirmed "${p.taskTitle}" is complete.`,
  };
}

// ── new_task_matching — the §10 board digest. BOARD-VISIBLE FIELDS ONLY:
//    title, category, area label, suggested budget — the §7.2 audience
//    already reads all of these; nothing that locates or identifies. ───────

export interface DigestTaskLine {
  taskId: string;
  title: string;
  category: string;
  areaLabel: string;
  suggestedBudget: number | null;
}

export function buildNewTaskDigest(
  lang: DoLang,
  tasks: DigestTaskLine[],
): DoNotificationContent {
  const n = tasks.length;
  const lines = tasks
    .map((t) => {
      const budget =
        t.suggestedBudget !== null
          ? lang === 'fr'
            ? ` · budget indicatif ${t.suggestedBudget} €`
            : ` · suggested €${t.suggestedBudget}`
          : '';
      return `<li style="margin-bottom: 8px;"><a href="${DOER_TASK_URL(t.taskId)}" style="color: #0d8204; font-weight: 600;">${escapeHtml(t.title)}</a><br/><span style="color: #6B7280; font-size: 13px;">${escapeHtml(categoryLabel(lang, t.category))} · ${escapeHtml(t.areaLabel)}${escapeHtml(budget)}</span></li>`;
    })
    .join('\n');
  if (lang === 'fr') {
    return {
      subject:
        n === 1
          ? '1 nouvelle tâche dans vos catégories'
          : `${n} nouvelles tâches dans vos catégories`,
      emailBody: `
        <p>${n === 1 ? 'Une nouvelle tâche correspond' : 'De nouvelles tâches correspondent'} aux catégories qui vous intéressent :</p>
        <ul style="padding-left: 20px;">${lines}</ul>
        ${cta(BOARD_URL, 'Voir le tableau')}
        <p style="color: #6B7280; font-size: 13px;">Vous recevez ce résumé car les nouvelles tâches vous intéressent — réglable dans votre profil.</p>
      `,
      title: n === 1 ? '1 nouvelle tâche pour vous' : `${n} nouvelles tâches pour vous`,
      body:
        n === 1
          ? `« ${tasks[0].title} » (${categoryLabel(lang, tasks[0].category)}, ${tasks[0].areaLabel})`
          : `${n} nouvelles tâches dans vos catégories — jetez un œil au tableau.`,
    };
  }
  return {
    subject:
      n === 1
        ? '1 new task in your categories'
        : `${n} new tasks in your categories`,
    emailBody: `
      <p>${n === 1 ? 'A new task matches' : 'New tasks match'} the categories you're interested in:</p>
      <ul style="padding-left: 20px;">${lines}</ul>
      ${cta(BOARD_URL, 'Browse the board')}
      <p style="color: #6B7280; font-size: 13px;">You get this digest because you opted into new-task updates — adjustable on your profile.</p>
    `,
    title: n === 1 ? '1 new task for you' : `${n} new tasks for you`,
    body:
      n === 1
        ? `"${tasks[0].title}" (${categoryLabel(lang, tasks[0].category)}, ${tasks[0].areaLabel})`
        : `${n} new tasks in your categories — take a look at the board.`,
  };
}
