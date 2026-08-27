import { useTranslation } from 'react-i18next';
import { TopNav } from '@ejm/shared-ui';

// Mirrors sit's guide pages (issue #236, parity A3): TopNav + numbered steps,
// copy inlined per locale (no i18n keys — both languages ship with the page,
// exactly like apps/web/src/pages/public/BabysitterGuidePage.tsx).
function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{number}</div>
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="ml-10 text-sm leading-relaxed text-gray-600">{children}</div>
    </div>
  );
}

export function TutorGuidePage() {
  const { i18n } = useTranslation();
  const fr = i18n.language?.startsWith('fr');

  return (
    <div>
      <TopNav title={fr ? 'Guide Tuteurs' : 'Tutor Guide'} backTo="back" />
      <div className="px-5 pt-4 pb-8">
        <div className="mb-6 flex flex-col items-center">
          <img src="/logo.png" alt="Sync/Study" className="mb-3 h-20 w-20 rounded-2xl" />
          <h1 className="mb-1 text-xl font-bold text-gray-900">{fr ? 'Comment utiliser Sync/Study' : 'How to use Sync/Study'}</h1>
          <p className="text-center text-sm text-gray-500">{fr ? 'Guide pour les tuteurs' : 'A guide for tutors'}</p>
        </div>

        <div className="mb-6 rounded-xl bg-brand-50 p-4">
          <p className="text-sm font-medium text-brand-800">
            {fr
              ? 'Sync/Study vous connecte avec des familles EJM qui recherchent du soutien scolaire. Voici comment commencer, recevoir des demandes de contact et gérer vos séances.'
              : 'Sync/Study connects you with EJM families looking for tutoring. Here\'s how to get started, receive contact requests, and manage your sessions.'}
          </p>
        </div>

        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Premiers pas' : 'Getting Started'}</h2>

        <Step number={1} title={fr ? 'Créer un compte' : 'Create an account'}>
          <p>
            {fr
              ? 'Ouvrez Sync/Study et cliquez sur "Tuteur". Vérifiez votre email EJM avec le code reçu, créez un mot de passe, puis renseignez votre profil et vos matières.'
              : 'Open Sync/Study and tap "Tutor". Verify your EJM email with the code you receive, create a password, then fill in your profile and subjects.'}
          </p>
        </Step>

        <Step number={2} title={fr ? 'Compléter votre profil' : 'Complete your profile'}>
          <p>
            {fr
              ? 'Ajoutez une photo de profil, une description "À propos de moi" et vos coordonnées (email, téléphone, WhatsApp). Vos coordonnées ne sont visibles que par les familles que vous avez approuvées.'
              : 'Add a profile photo, an "About me" description, and your contact details (email, phone, WhatsApp). Your contact details are only visible to families you have approved.'}
          </p>
        </Step>

        <Step number={3} title={fr ? 'Définir vos matières et tarifs' : 'Set your subjects and rates'}>
          <p>
            {fr
              ? 'Dans le menu, allez dans "Matières et tarifs" pour choisir les matières que vous enseignez, les niveaux de classe que vous acceptez et votre tarif horaire pour chaque matière.'
              : 'From the menu, go to "Subjects & Rates" to choose the subjects you teach, the class levels you accept, and your hourly rate for each subject.'}
          </p>
        </Step>

        <Step number={4} title={fr ? 'Définir votre zone et vos disponibilités' : 'Set your area and availability'}>
          <p>
            {fr
              ? 'Dans le menu, ouvrez "Disponibilités" pour configurer vos créneaux hebdomadaires. C\'est aussi là que vous définissez votre délai de préavis d\'annulation. Votre zone d\'intervention ("Zone couverte") se règle depuis "Mon compte".'
              : 'From the menu, open "Schedule" to set up your weekly availability slots. This is also where you set your cancellation notice window. Your coverage area ("Area you cover") is set from "My Account".'}
          </p>
        </Step>

        <Step number={5} title={fr ? 'Rendre votre profil visible' : 'Make your profile visible'}>
          <p>
            {fr
              ? 'Par défaut, votre profil n\'apparaît pas dans la recherche. Une fois vos matières et au moins un créneau de disponibilité renseignés, utilisez le bouton d\'activation en haut de votre tableau de bord pour le rendre visible. Vous pouvez le désactiver à tout moment (par exemple pendant les examens).'
              : 'By default, your profile does not appear in search. Once you\'ve added your subjects and at least one availability slot, use the activation toggle at the top of your dashboard to make it visible. You can turn it off anytime (e.g. during exams).'}
          </p>
        </Step>

        <hr className="my-6 border-gray-200" />
        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Demandes de contact' : 'Contact Requests'}</h2>

        <Step number={6} title={fr ? 'Recevoir des demandes de contact' : 'Receive contact requests'}>
          <p>
            {fr
              ? 'Avant toute séance, une demande de contact doit être acceptée. En général, une famille vous en envoie une pour une matière et un niveau, avec un message optionnel — vous recevez une notification push et un email, et la demande apparaît sur votre tableau de bord. Vous pouvez aussi faire le premier pas en répondant à une recherche publiée par une famille ("Annonces des familles" sur votre tableau de bord — jusqu\'à 5 annonces par 24 heures).'
              : 'Before any sessions, a contact request has to be accepted. Usually a family sends you one for a subject and class level, with an optional message — you\'ll receive a push notification and an email, and the request appears on your dashboard. You can also make the first move by answering a family\'s published search (the "Posts from families" board on your dashboard — up to 5 posts per 24 hours).'}
          </p>
        </Step>

        <Step number={7} title={fr ? 'Accepter ou refuser' : 'Accept or decline'}>
          <p>
            {fr
              ? 'Accepter une demande débloque la relation : la famille voit alors vos coordonnées et peut vous proposer des séances. L\'approbation est définitive — elle ne peut pas être annulée. Si vous refusez, la famille devra attendre 7 jours avant de vous renvoyer une demande.'
              : 'Accepting a request unlocks the relationship: the family can then see your contact details and book sessions with you. Approval is permanent — it cannot be undone. If you decline, the family must wait 7 days before sending you another request.'}
          </p>
        </Step>

        <Step number={8} title={fr ? 'Mes Familles' : 'My Families'}>
          <p>
            {fr
              ? 'Dans le menu, "Mes Familles" liste toutes les familles que vous avez approuvées. C\'est avec elles que vos séances peuvent être organisées.'
              : 'From the menu, "My Families" lists every family you have approved. These are the families your sessions can be arranged with.'}
          </p>
        </Step>

        <hr className="my-6 border-gray-200" />
        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Séances de tutorat' : 'Tutoring Sessions'}</h2>

        <Step number={9} title={fr ? 'Recevoir des demandes de séance' : 'Receive session requests'}>
          <p>
            {fr
              ? 'Une famille approuvée peut demander une séance ponctuelle ou hebdomadaire récurrente, au moins 24 heures à l\'avance, sur vos créneaux disponibles. Le tarif de la matière est fixé au moment de la demande.'
              : 'An approved family can request a one-time or weekly recurring session, at least 24 hours ahead, within your available slots. The subject\'s rate is locked in when the request is made.'}
          </p>
        </Step>

        <Step number={10} title={fr ? 'Confirmer ou refuser une séance' : 'Confirm or decline a session'}>
          <p>
            {fr
              ? 'Une demande en attente ne bloque rien dans votre planning : les créneaux ne sont réservés que lorsque vous confirmez. La famille est notifiée de votre décision. Une famille peut retirer sa propre demande tant qu\'elle est en attente.'
              : 'A pending request claims nothing in your schedule: slots are only blocked once you confirm. The family is notified of your decision. A family can withdraw their own request while it\'s still pending.'}
          </p>
        </Step>

        <Step number={11} title={fr ? 'Proposer une séance' : 'Propose a session'}>
          <p>
            {fr
              ? 'Vous pouvez aussi proposer une séance ponctuelle à une famille approuvée. La famille confirme et choisit quels enfants y participent. Tant que votre proposition est en attente, vous pouvez la retirer — le retrait appartient toujours à celui qui a ouvert la demande.'
              : 'You can also propose a one-time session to an approved family. The family confirms and picks which children attend. While your proposal is pending you can withdraw it — withdrawal always belongs to whoever opened the request.'}
          </p>
        </Step>

        <Step number={12} title={fr ? 'Modifications et annulations' : 'Changes and cancellations'}>
          <p>
            {fr
              ? 'Une famille peut modifier une séance ponctuelle confirmée : la séance reste réservée et vous serez invité(e) à confirmer la prise en compte des changements ("Bien reçu"). Si une séance confirmée doit être annulée, appuyez sur sa carte et donnez une courte raison — l\'autre partie est notifiée. Votre délai de préavis (défini sur votre page "Disponibilités") indique aux familles le préavis attendu ; les annulations tardives sont signalées. Annulez le plus tôt possible.'
              : 'A family can modify a confirmed one-time session: the session stays booked, and you\'ll be asked to acknowledge the changes ("Got it"). If a confirmed session must be cancelled, tap its card and give a short reason — the other side is notified. Your notice window (set on your "Schedule" page) tells families how much notice you expect; late cancellations are flagged. Cancel as early as you can.'}
          </p>
        </Step>

        <hr className="my-6 border-gray-200" />
        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Votre profil et compte' : 'Your Profile & Account'}</h2>

        <Step number={13} title={fr ? 'Recommandations' : 'Endorsements'}>
          <p>
            {fr
              ? 'Dans le menu, allez dans "Recommandations" pour gérer vos recommandations. Une famille peut en soumettre une (une seule par famille) dès que vous avez accepté sa demande de contact. Chaque recommandation est privée par défaut — vous choisissez lesquelles publier pour qu\'elles soient visibles par les autres familles.'
              : 'From the menu, go to "Endorsements" to manage your endorsements. A family can submit one (one per family) as soon as you\'ve accepted their contact request. Each endorsement is private by default — you choose which ones to publish so they\'re visible to other families.'}
          </p>
        </Step>

        <Step number={14} title={fr ? 'Mon compte et notifications' : 'My Account & notifications'}>
          <p>
            {fr
              ? 'Dans "Mon compte", gérez votre photo, vos coordonnées, votre mot de passe et la langue de l\'application. Activez les notifications push pour ne manquer ni demandes de contact, ni demandes de séance, ni annulations — push et email se règlent séparément.'
              : 'In "My Account", manage your photo, contact details, password, and app language. Enable push notifications so you don\'t miss contact requests, session requests, or cancellations — push and email are configured separately.'}
          </p>
        </Step>
      </div>
    </div>
  );
}
