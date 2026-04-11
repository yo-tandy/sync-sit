import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui';

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">{number}</div>
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="ml-10 text-sm leading-relaxed text-gray-600">{children}</div>
    </div>
  );
}

export function BabysitterGuidePage() {
  const { i18n } = useTranslation();
  const fr = i18n.language?.startsWith('fr');

  return (
    <div>
      <TopNav title={fr ? 'Guide Babysitters' : 'Babysitter Guide'} backTo="back" />
      <div className="px-5 pt-4 pb-8">
        <div className="mb-6 flex flex-col items-center">
          <img src="/logo.png" alt="Sync/Sit" className="mb-3 h-20 w-20 rounded-2xl" />
          <h1 className="mb-1 text-xl font-bold text-gray-900">{fr ? 'Comment utiliser Sync/Sit' : 'How to use Sync/Sit'}</h1>
          <p className="text-center text-sm text-gray-500">{fr ? 'Guide pour les babysitters' : 'A guide for babysitters'}</p>
        </div>

        <div className="mb-6 rounded-xl bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            {fr
              ? 'Sync/Sit vous connecte avec des familles EJM qui recherchent un babysitter. Voici comment commencer et recevoir des demandes.'
              : 'Sync/Sit connects you with EJM families looking for a babysitter. Here\'s how to get started and receive requests.'}
          </p>
        </div>

        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Premiers pas' : 'Getting Started'}</h2>

        <Step number={1} title={fr ? 'Créer un compte' : 'Create an account'}>
          <p>
            {fr
              ? 'Rendez-vous sur sync-sit.com et cliquez sur "Babysitter". Vérifiez votre email EJM avec le code reçu. Renseignez vos informations personnelles : nom, prénom, date de naissance, classe et genre.'
              : 'Go to sync-sit.com and tap "Babysitter". Verify your EJM email with the code you receive. Fill in your personal details: first name, last name, date of birth, class level, and gender.'}
          </p>
        </Step>

        <Step number={2} title={fr ? 'Compléter votre profil' : 'Complete your profile'}>
          <p>
            {fr
              ? 'Ajoutez une photo de profil, une description "À propos de moi" et vos coordonnées (email, téléphone, WhatsApp). Les familles verront ces informations quand elles vous trouveront dans la recherche.'
              : 'Add a profile photo, an "About me" description, and your contact details (email, phone, WhatsApp). Families will see this information when they find you in search.'}
          </p>
        </Step>

        <Step number={3} title={fr ? 'Configurer vos options de babysitting' : 'Set your babysitting options'}>
          <p>
            {fr
              ? 'Dans le menu, allez dans "Options de babysitting" pour définir les langues parlées, vos préférences d\'âge des enfants, le nombre maximum d\'enfants, votre tarif minimum et vos zones de disponibilité (par arrondissement ou par distance).'
              : 'From the menu, go to "Babysitting Options" to set your spoken languages, child age preferences, maximum number of kids, minimum hourly rate, and the areas where you\'re available (by arrondissement or by distance).'}
          </p>
        </Step>

        <Step number={4} title={fr ? 'Définir vos disponibilités' : 'Set your availability'}>
          <p>
            {fr
              ? 'Depuis votre tableau de bord, appuyez sur "Mes disponibilités". Configurez votre planning hebdomadaire en sélectionnant les créneaux où vous êtes disponible pour chaque jour de la semaine. Vous pouvez aussi configurer des disponibilités différentes pour les vacances scolaires.'
              : 'From your dashboard, tap "My Availability". Set up your weekly schedule by selecting the time slots when you\'re available for each day of the week. You can also configure different availability for school holidays.'}
          </p>
        </Step>

        <Step number={5} title={fr ? 'Activer votre profil' : 'Activate your profile'}>
          <p>
            {fr
              ? 'Par défaut, votre profil n\'est pas visible dans la recherche. Pour le rendre visible, appuyez sur le bouton "Inactif" en haut de votre tableau de bord et confirmez l\'activation. Vous pouvez le désactiver à tout moment (par exemple pendant les examens).'
              : 'By default, your profile is not visible in search. To make it visible, tap the "Inactive" button at the top of your dashboard and confirm activation. You can deactivate it anytime (e.g. during exams).'}
          </p>
        </Step>

        <hr className="my-6 border-gray-200" />
        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Recevoir et gérer les demandes' : 'Receiving & Managing Requests'}</h2>

        <Step number={6} title={fr ? 'Recevoir des demandes' : 'Receive requests'}>
          <p>
            {fr
              ? 'Quand une famille vous envoie une demande, vous recevez une notification push et un email. La demande apparaît dans la section "Nouvelles demandes" de votre tableau de bord avec les détails : date, heure, nombre d\'enfants, adresse et tarif proposé.'
              : 'When a family sends you a request, you\'ll receive a push notification and an email. The request appears in the "New Requests" section of your dashboard with details: date, time, number of children, address, and proposed rate.'}
          </p>
        </Step>

        <Step number={7} title={fr ? 'Accepter ou refuser' : 'Accept or decline'}>
          <p>
            {fr
              ? 'Appuyez sur la demande pour voir les détails complets. Vous pouvez accepter ou refuser. En acceptant, vous pouvez aussi bloquer ce créneau dans votre planning. La famille sera notifiée de votre décision par email et notification push.'
              : 'Tap the request to see full details. You can accept or decline. When accepting, you can also block that time slot in your schedule. The family will be notified of your decision by email and push notification.'}
          </p>
        </Step>

        <Step number={8} title={fr ? 'Contacter la famille' : 'Contact the family'}>
          <p>
            {fr
              ? 'Les coordonnées des parents (email, téléphone, WhatsApp) apparaissent sur la page de détail de chaque demande, dès sa réception. Appuyez directement pour appeler, envoyer un email ou ouvrir une conversation WhatsApp.'
              : 'The parents\' contact details (email, phone, WhatsApp) appear on the detail page of each request, as soon as you receive it. Tap directly to call, email, or open a WhatsApp conversation.'}
          </p>
        </Step>

        <Step number={9} title={fr ? 'Ajouter au calendrier' : 'Add to calendar'}>
          <p>
            {fr
              ? 'Les rendez-vous confirmés affichent un lien "Ajouter au calendrier". Il crée automatiquement un événement avec la date, l\'heure et l\'adresse dans votre application de calendrier. Ce lien apparaît aussi juste après avoir accepté une demande.'
              : 'Confirmed appointments show an "Add to calendar" link. It automatically creates an event with the date, time, and address in your calendar app. This link also appears right after you accept a request.'}
          </p>
        </Step>

        <Step number={10} title={fr ? 'Annuler un rendez-vous' : 'Cancel an appointment'}>
          <p>
            {fr
              ? 'Si vous devez annuler un rendez-vous confirmé, appuyez sur la carte et sélectionnez "Annuler". Vous devrez fournir une raison. La famille sera notifiée. Essayez d\'annuler le plus tôt possible pour que la famille puisse trouver un remplacement.'
              : 'If you need to cancel a confirmed appointment, tap the card and select "Cancel". You\'ll need to provide a reason. The family will be notified. Try to cancel as early as possible so the family can find a replacement.'}
          </p>
        </Step>

        <hr className="my-6 border-gray-200" />
        <h2 className="mb-4 text-lg font-bold text-gray-900">{fr ? 'Votre profil et compte' : 'Your Profile & Account'}</h2>

        <Step number={11} title={fr ? 'Recommandations' : 'Endorsements'}>
          <p>
            {fr
              ? 'Dans le menu, allez dans "Recommandations" pour gérer vos recommandations. Vous pouvez ajouter manuellement des recommandations de personnes pour lesquelles vous avez travaillé, et les familles EJM peuvent en soumettre directement depuis leur compte. Chaque recommandation est privée par défaut — vous choisissez lesquelles publier pour qu\'elles soient visibles par les autres parents.'
              : 'From the menu, go to "Endorsements" to manage your endorsements. You can manually add endorsements from people you\'ve worked for, and EJM families can submit them directly from their account. Each endorsement is private by default — you choose which ones to publish so they\'re visible to other parents.'}
          </p>
        </Step>

        <Step number={12} title={fr ? 'Mon compte' : 'My Account'}>
          <p>
            {fr
              ? 'Dans "Mon compte" vous pouvez voir vos informations personnelles, gérer votre photo, vos coordonnées (email, téléphone, WhatsApp), changer de mot de passe, configurer les notifications et choisir la langue de l\'application.'
              : 'In "My Account" you can view your personal info, manage your photo, contact details (email, phone, WhatsApp), change password, configure notifications, and choose the app language.'}
          </p>
        </Step>

        <Step number={13} title={fr ? 'Mes Familles' : 'My Families'}>
          <p>
            {fr
              ? 'Dans le menu, allez dans "Mes Familles" pour voir les familles qui vous ont ajouté(e) à leurs favoris. Vous pouvez choisir de partager ou non vos coordonnées avec chaque famille. Quand une famille vous envoie une demande de babysitting, elle verra toujours vos coordonnées pour ce rendez-vous, indépendamment de ces réglages.'
              : 'From the menu, go to "My Families" to see families who added you to their favorites. You can choose whether to share your contact information with each family. When a family sends you a babysitting request, they will always see your contact info for that appointment, regardless of these settings.'}
          </p>
        </Step>

        <Step number={14} title={fr ? 'Notifications' : 'Notifications'}>
          <p>
            {fr
              ? 'Vous recevez des notifications pour les nouvelles demandes, les annulations et les rappels. Activez les notifications push pour ne pas manquer de demandes. Vous pouvez personnaliser les notifications push et email séparément dans "Mon compte".'
              : 'You receive notifications for new requests, cancellations, and reminders. Enable push notifications so you don\'t miss requests. You can customize push and email notifications separately in "My Account".'}
          </p>
        </Step>
      </div>
    </div>
  );
}
