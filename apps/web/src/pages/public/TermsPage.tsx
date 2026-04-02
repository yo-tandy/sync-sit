import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui';

interface Section {
  titleEn: string;
  titleFr: string;
  contentEn: string;
  contentFr: string;
}

const sections: Section[] = [
  {
    titleEn: '1. Acceptance of Terms',
    titleFr: '1. Acceptation des conditions',
    contentEn:
      'By creating an account on Sync/Sit or using the platform in any way, you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree with any part of these terms, you must not use the platform.\n\n' +
      'These terms constitute a legally binding agreement between you and the operator of Sync/Sit. Please read them carefully before using the service.',
    contentFr:
      'En créant un compte sur Sync/Sit ou en utilisant la plateforme de quelque manière que ce soit, vous acceptez d\'être lié(e) par les présentes Conditions Générales d\'Utilisation et notre Politique de confidentialité. Si vous n\'acceptez pas tout ou partie de ces conditions, vous ne devez pas utiliser la plateforme.\n\n' +
      'Les présentes conditions constituent un accord juridiquement contraignant entre vous et l\'exploitant de Sync/Sit. Veuillez les lire attentivement avant d\'utiliser le service.',
  },
  {
    titleEn: '2. Description of Service',
    titleFr: '2. Description du service',
    contentEn:
      'Sync/Sit is a non-commercial platform that connects families of the École Jeannine Manuel (EJM) community in Paris with EJM student babysitters aged 15 to 18.\n\n' +
      'The platform provides the following features:\n' +
      '- Profile creation for parents and babysitters\n' +
      '- Identity and school enrollment verification for babysitters\n' +
      '- Proximity-based search for babysitters\n' +
      '- Scheduling and appointment management\n' +
      '- In-app communication via notifications\n' +
      '- Community verification through peer vouching\n\n' +
      'Sync/Sit is a facilitator only. It connects families with babysitters but does not employ, supervise, or manage babysitters in any way.',
    contentFr:
      'Sync/Sit est une plateforme non commerciale qui met en relation les familles de la communauté de l\'École Jeannine Manuel (EJM) à Paris avec des élèves babysitters de l\'EJM âgés de 15 à 18 ans.\n\n' +
      'La plateforme offre les fonctionnalités suivantes :\n' +
      '- Création de profils pour les parents et les babysitters\n' +
      '- Vérification de l\'identité et de la scolarité des babysitters\n' +
      '- Recherche de babysitters par proximité géographique\n' +
      '- Gestion des disponibilités et des rendez-vous\n' +
      '- Communication via notifications dans l\'application\n' +
      '- Vérification communautaire par parrainage entre pairs\n\n' +
      'Sync/Sit agit uniquement en tant qu\'intermédiaire. La plateforme met en relation les familles avec les babysitters mais n\'emploie, ne supervise et ne gère les babysitters d\'aucune manière.',
  },
  {
    titleEn: '3. Eligibility',
    titleFr: '3. Conditions d\'éligibilité',
    contentEn:
      'To use Sync/Sit, you must meet the following eligibility requirements:\n\n' +
      'Parents:\n' +
      '- Must be a parent or legal guardian within the EJM community\n' +
      '- Must provide a valid email address for verification\n' +
      '- Must complete the identity verification process\n\n' +
      'Babysitters:\n' +
      '- Must be a currently enrolled student at École Jeannine Manuel\n' +
      '- Must be between 15 and 18 years of age\n' +
      '- Must have a valid EJM school email address (@ejm.org)\n' +
      '- Must submit a valid government-issued ID and school enrollment certificate for verification\n\n' +
      'In accordance with French law (Article 8 of the GDPR, as implemented in France), individuals aged 15 and over may consent to the processing of their personal data. Babysitters aged 15 to 18 create their accounts with their own consent.',
    contentFr:
      'Pour utiliser Sync/Sit, vous devez remplir les conditions d\'éligibilité suivantes :\n\n' +
      'Parents :\n' +
      '- Être parent ou représentant légal au sein de la communauté EJM\n' +
      '- Fournir une adresse e-mail valide pour la vérification\n' +
      '- Compléter le processus de vérification d\'identité\n\n' +
      'Babysitters :\n' +
      '- Être un(e) élève actuellement inscrit(e) à l\'École Jeannine Manuel\n' +
      '- Être âgé(e) de 15 à 18 ans\n' +
      '- Disposer d\'une adresse e-mail scolaire EJM valide (@ejm.org)\n' +
      '- Soumettre une pièce d\'identité officielle et un certificat de scolarité valides pour vérification\n\n' +
      'Conformément au droit français (article 8 du RGPD, tel que transposé en France), les personnes âgées de 15 ans et plus peuvent consentir au traitement de leurs données personnelles. Les babysitters âgés de 15 à 18 ans créent leur compte avec leur propre consentement.',
  },
  {
    titleEn: '4. Account Creation and Verification',
    titleFr: '4. Création de compte et vérification',
    contentEn:
      'All users must create an account to access Sync/Sit. Account creation requires:\n\n' +
      '- Providing accurate and complete personal information\n' +
      '- Verifying your email address through a magic link sent to your email\n' +
      '- For babysitters: completing the full verification process including ID document submission, school enrollment proof, and EJM email verification\n' +
      '- For parents: completing the parent verification process\n\n' +
      'You are responsible for maintaining the security of your account. You must not share your authentication links with anyone. You must notify us immediately at support@sync-sit.com if you suspect unauthorised access to your account.\n\n' +
      'We reserve the right to refuse, suspend, or terminate any account that fails verification or provides false information.',
    contentFr:
      'Tous les utilisateurs doivent créer un compte pour accéder à Sync/Sit. La création de compte nécessite :\n\n' +
      '- La fourniture d\'informations personnelles exactes et complètes\n' +
      '- La vérification de votre adresse e-mail via un lien magique envoyé à votre adresse\n' +
      '- Pour les babysitters : la réalisation complète du processus de vérification comprenant la soumission d\'une pièce d\'identité, d\'un justificatif de scolarité et la vérification de l\'adresse e-mail EJM\n' +
      '- Pour les parents : la réalisation du processus de vérification parentale\n\n' +
      'Vous êtes responsable de la sécurité de votre compte. Vous ne devez en aucun cas partager vos liens d\'authentification. Vous devez nous notifier immédiatement à support@sync-sit.com si vous soupçonnez un accès non autorisé à votre compte.\n\n' +
      'Nous nous réservons le droit de refuser, suspendre ou résilier tout compte qui échoue à la vérification ou fournit de fausses informations.',
  },
  {
    titleEn: '5. User Responsibilities',
    titleFr: '5. Responsabilités des utilisateurs',
    contentEn:
      'All users of Sync/Sit agree to:\n\n' +
      '- Provide accurate, current, and complete information in their profile\n' +
      '- Update their information promptly if it changes\n' +
      '- Treat all other users with respect and courtesy\n' +
      '- Use the platform only for its intended purpose of arranging babysitting within the EJM community\n' +
      '- Not use the platform for any commercial, fraudulent, or illegal purpose\n' +
      '- Not harass, threaten, or intimidate other users\n' +
      '- Comply with all applicable laws and regulations, including French law regarding childcare and employment of minors',
    contentFr:
      'Tous les utilisateurs de Sync/Sit s\'engagent à :\n\n' +
      '- Fournir des informations exactes, à jour et complètes dans leur profil\n' +
      '- Mettre à jour leurs informations dans les meilleurs délais en cas de changement\n' +
      '- Traiter tous les autres utilisateurs avec respect et courtoisie\n' +
      '- Utiliser la plateforme uniquement aux fins prévues d\'organisation de gardes d\'enfants au sein de la communauté EJM\n' +
      '- Ne pas utiliser la plateforme à des fins commerciales, frauduleuses ou illégales\n' +
      '- Ne pas harceler, menacer ou intimider d\'autres utilisateurs\n' +
      '- Respecter toutes les lois et réglementations applicables, y compris le droit français relatif à la garde d\'enfants et à l\'emploi des mineurs',
  },
  {
    titleEn: '6. Babysitter Responsibilities',
    titleFr: '6. Responsabilités des babysitters',
    contentEn:
      'Babysitters using Sync/Sit agree to:\n\n' +
      '- Be reliable and honour confirmed appointments\n' +
      '- Inform families promptly if they need to cancel or reschedule\n' +
      '- Behave appropriately and responsibly when caring for children\n' +
      '- Maintain the safety and well-being of children in their care at all times\n' +
      '- Not consume alcohol, drugs, or any impairing substance before or during babysitting\n' +
      '- Contact the parents and, if necessary, emergency services immediately in case of any incident\n' +
      '- Keep all personal information about families and children confidential\n' +
      '- Accurately represent their availability and qualifications',
    contentFr:
      'Les babysitters utilisant Sync/Sit s\'engagent à :\n\n' +
      '- Être fiables et honorer les rendez-vous confirmés\n' +
      '- Informer les familles dans les meilleurs délais en cas d\'annulation ou de report nécessaire\n' +
      '- Se comporter de manière appropriée et responsable lors de la garde d\'enfants\n' +
      '- Assurer en permanence la sécurité et le bien-être des enfants qui leur sont confiés\n' +
      '- Ne pas consommer d\'alcool, de drogues ou de toute substance altérant les capacités avant ou pendant la garde\n' +
      '- Contacter les parents et, si nécessaire, les services d\'urgence immédiatement en cas d\'incident\n' +
      '- Garder confidentielles toutes les informations personnelles concernant les familles et les enfants\n' +
      '- Représenter fidèlement leurs disponibilités et leurs compétences',
  },
  {
    titleEn: '7. Parent Responsibilities',
    titleFr: '7. Responsabilités des parents',
    contentEn:
      'Parents using Sync/Sit agree to:\n\n' +
      '- Provide accurate information about their children (names, ages, languages, any special needs or instructions)\n' +
      '- Clearly communicate expectations, house rules, and emergency procedures to the babysitter before each appointment\n' +
      '- Ensure the babysitter has all necessary contact numbers and instructions\n' +
      '- Be reachable by phone during the babysitting appointment\n' +
      '- Return home at the agreed-upon time or communicate any delays promptly\n' +
      '- Pay the babysitter directly and promptly as agreed between the parties\n' +
      '- Complete the verification process to help maintain community trust\n' +
      '- Treat babysitters with respect, keeping in mind they are students aged 15 to 18',
    contentFr:
      'Les parents utilisant Sync/Sit s\'engagent à :\n\n' +
      '- Fournir des informations exactes concernant leurs enfants (prénoms, âges, langues, besoins particuliers ou instructions spécifiques)\n' +
      '- Communiquer clairement les attentes, les règles de la maison et les procédures d\'urgence au babysitter avant chaque rendez-vous\n' +
      '- S\'assurer que le babysitter dispose de tous les numéros de téléphone et instructions nécessaires\n' +
      '- Rester joignable par téléphone pendant la durée de la garde\n' +
      '- Rentrer à l\'heure convenue ou communiquer tout retard dans les meilleurs délais\n' +
      '- Rémunérer le babysitter directement et sans délai selon les modalités convenues entre les parties\n' +
      '- Compléter le processus de vérification afin de contribuer à la confiance au sein de la communauté\n' +
      '- Traiter les babysitters avec respect, en gardant à l\'esprit qu\'il s\'agit d\'élèves âgés de 15 à 18 ans',
  },
  {
    titleEn: '8. Platform Role and Limitation of Liability',
    titleFr: '8. Rôle de la plateforme et limitation de responsabilité',
    contentEn:
      'Sync/Sit acts solely as an intermediary that facilitates connections between families and babysitters within the EJM community. Sync/Sit:\n\n' +
      '- Is not an employer, agency, or contractor of any babysitter\n' +
      '- Does not supervise, direct, or control babysitting activities\n' +
      '- Does not guarantee the quality, safety, or outcome of any babysitting arrangement\n' +
      '- Does not participate in or mediate financial transactions between users\n' +
      '- Does not verify the suitability of any babysitter for any particular child or family\n\n' +
      'The babysitting relationship is exclusively between the parent and the babysitter. Parents are responsible for interviewing, selecting, and supervising the babysitters they choose.\n\n' +
      'To the maximum extent permitted by applicable law, including Articles 1240 and following of the French Civil Code, Sync/Sit and its operator shall not be held liable for:\n' +
      '- Any damage, injury, loss, or harm arising from babysitting arrangements made through the platform\n' +
      '- The conduct, actions, or omissions of any user, whether parent or babysitter\n' +
      '- The accuracy or completeness of information provided by users\n' +
      '- Service interruptions, technical errors, or data loss\n\n' +
      'Nothing in these terms excludes or limits liability for death or personal injury caused by negligence, fraud, or any other liability that cannot be excluded or limited under French law.',
    contentFr:
      'Sync/Sit agit uniquement en tant qu\'intermédiaire facilitant la mise en relation entre les familles et les babysitters au sein de la communauté EJM. Sync/Sit :\n\n' +
      '- N\'est pas l\'employeur, l\'agence ou le prestataire d\'aucun babysitter\n' +
      '- Ne supervise, ne dirige et ne contrôle pas les activités de garde d\'enfants\n' +
      '- Ne garantit pas la qualité, la sécurité ou le résultat de toute garde d\'enfants\n' +
      '- Ne participe pas aux transactions financières entre utilisateurs et n\'en assure pas la médiation\n' +
      '- Ne vérifie pas l\'adéquation d\'un babysitter pour un enfant ou une famille en particulier\n\n' +
      'La relation de garde est exclusivement établie entre le parent et le babysitter. Les parents sont responsables de l\'entretien, de la sélection et de la supervision des babysitters qu\'ils choisissent.\n\n' +
      'Dans la limite maximale autorisée par le droit applicable, y compris les articles 1240 et suivants du Code civil français, Sync/Sit et son exploitant ne sauraient être tenus responsables :\n' +
      '- De tout dommage, blessure, perte ou préjudice résultant de gardes d\'enfants organisées via la plateforme\n' +
      '- Du comportement, des actes ou des omissions de tout utilisateur, qu\'il soit parent ou babysitter\n' +
      '- De l\'exactitude ou de l\'exhaustivité des informations fournies par les utilisateurs\n' +
      '- Des interruptions de service, erreurs techniques ou pertes de données\n\n' +
      'Rien dans les présentes conditions n\'exclut ou ne limite la responsabilité en cas de décès ou de dommage corporel causé par une négligence, une fraude, ou toute autre responsabilité qui ne peut être exclue ou limitée en vertu du droit français.',
  },
  {
    titleEn: '9. Payment',
    titleFr: '9. Rémunération',
    contentEn:
      'Sync/Sit is a free, non-commercial platform. It does not charge any fees, commissions, or subscriptions.\n\n' +
      'Payment for babysitting services is arranged and made directly between the parent and the babysitter. Sync/Sit does not process, facilitate, or mediate any financial transactions.\n\n' +
      'Parents and babysitters are solely responsible for agreeing on compensation, payment method, and timing. Sync/Sit has no visibility into and accepts no liability for these arrangements.\n\n' +
      'Users are responsible for complying with all applicable tax and employment regulations, including regulations regarding the employment of minors under French law.',
    contentFr:
      'Sync/Sit est une plateforme gratuite et non commerciale. Elle ne facture aucun frais, commission ou abonnement.\n\n' +
      'La rémunération des services de garde est convenue et versée directement entre le parent et le babysitter. Sync/Sit ne traite, ne facilite et n\'assure la médiation d\'aucune transaction financière.\n\n' +
      'Les parents et les babysitters sont seuls responsables de convenir de la rémunération, du mode de paiement et des délais. Sync/Sit n\'a aucune visibilité sur ces arrangements et n\'accepte aucune responsabilité à leur égard.\n\n' +
      'Les utilisateurs sont responsables du respect de toutes les réglementations fiscales et sociales applicables, y compris les réglementations relatives à l\'emploi des mineurs en droit français.',
  },
  {
    titleEn: '10. Prohibited Uses',
    titleFr: '10. Utilisations interdites',
    contentEn:
      'The following uses of Sync/Sit are strictly prohibited:\n\n' +
      '- Creating a fake or misleading profile\n' +
      '- Impersonating another person or providing false identity documents\n' +
      '- Using the platform for any purpose other than arranging babysitting within the EJM community\n' +
      '- Soliciting users for commercial services, advertising, or spam\n' +
      '- Attempting to circumvent the verification process\n' +
      '- Harassing, bullying, or threatening any user\n' +
      '- Collecting or storing personal data of other users outside the platform\n' +
      '- Attempting to access the accounts of other users or the platform\'s administrative functions\n' +
      '- Using automated tools (bots, scrapers) to access the platform\n' +
      '- Any activity that violates applicable French or European law',
    contentFr:
      'Les utilisations suivantes de Sync/Sit sont strictement interdites :\n\n' +
      '- Créer un profil faux ou trompeur\n' +
      '- Usurper l\'identité d\'une autre personne ou fournir de faux documents d\'identité\n' +
      '- Utiliser la plateforme à toute fin autre que l\'organisation de gardes d\'enfants au sein de la communauté EJM\n' +
      '- Solliciter des utilisateurs à des fins commerciales, publicitaires ou de spam\n' +
      '- Tenter de contourner le processus de vérification\n' +
      '- Harceler, intimider ou menacer tout utilisateur\n' +
      '- Collecter ou stocker des données personnelles d\'autres utilisateurs en dehors de la plateforme\n' +
      '- Tenter d\'accéder aux comptes d\'autres utilisateurs ou aux fonctions administratives de la plateforme\n' +
      '- Utiliser des outils automatisés (robots, scrapers) pour accéder à la plateforme\n' +
      '- Toute activité contraire au droit français ou européen applicable',
  },
  {
    titleEn: '11. Community Verification Obligations',
    titleFr: '11. Obligations relatives à la vérification communautaire',
    contentEn:
      'Sync/Sit offers a community verification feature allowing verified members to vouch for other users. When you vouch for another user, you:\n\n' +
      '- Confirm that you personally know the individual\n' +
      '- Attest to your genuine belief that they are a trustworthy member of the EJM community\n' +
      '- Accept that your name may be recorded and visible to administrators in connection with the vouching\n\n' +
      'Vouching must be honest and made in good faith. Providing false vouches or vouching for individuals you do not know personally is a violation of these terms and may result in account suspension or termination.\n\n' +
      'Community verification is an additional trust signal and does not replace the platform\'s formal identity and school verification process.',
    contentFr:
      'Sync/Sit propose une fonctionnalité de vérification communautaire permettant aux membres vérifiés de se porter garants d\'autres utilisateurs. Lorsque vous vous portez garant d\'un autre utilisateur, vous :\n\n' +
      '- Confirmez que vous connaissez personnellement cette personne\n' +
      '- Attestez de votre conviction sincère qu\'il s\'agit d\'un membre digne de confiance de la communauté EJM\n' +
      '- Acceptez que votre nom puisse être enregistré et visible par les administrateurs dans le cadre du parrainage\n\n' +
      'Le parrainage doit être honnête et effectué de bonne foi. Fournir de faux parrainages ou se porter garant de personnes que vous ne connaissez pas personnellement constitue une violation des présentes conditions et peut entraîner la suspension ou la résiliation de votre compte.\n\n' +
      'La vérification communautaire est un indicateur de confiance supplémentaire et ne remplace pas le processus formel de vérification d\'identité et de scolarité de la plateforme.',
  },
  {
    titleEn: '12. Account Suspension and Termination',
    titleFr: '12. Suspension et résiliation de compte',
    contentEn:
      'We reserve the right to suspend or terminate your account at our discretion if:\n\n' +
      '- You violate any provision of these Terms of Service\n' +
      '- You provide false or misleading information\n' +
      '- You engage in conduct that is harmful to other users or to the platform\n' +
      '- Your verification is revoked or found to be invalid\n' +
      '- We receive credible complaints about your conduct\n\n' +
      'You may delete your account at any time through the app settings. Upon deletion, all your personal data will be permanently erased in accordance with our Privacy Policy.\n\n' +
      'We will endeavour to notify you of any suspension or termination and provide the reason, except where doing so would compromise safety or an ongoing investigation.',
    contentFr:
      'Nous nous réservons le droit de suspendre ou de résilier votre compte à notre discrétion si :\n\n' +
      '- Vous enfreignez toute disposition des présentes Conditions Générales d\'Utilisation\n' +
      '- Vous fournissez des informations fausses ou trompeuses\n' +
      '- Vous adoptez un comportement nuisible envers d\'autres utilisateurs ou la plateforme\n' +
      '- Votre vérification est révoquée ou jugée invalide\n' +
      '- Nous recevons des plaintes crédibles concernant votre conduite\n\n' +
      'Vous pouvez supprimer votre compte à tout moment via les paramètres de l\'application. Lors de la suppression, toutes vos données personnelles seront définitivement effacées conformément à notre Politique de confidentialité.\n\n' +
      'Nous nous efforcerons de vous notifier toute suspension ou résiliation et d\'en fournir le motif, sauf lorsque cela compromettrait la sécurité ou une enquête en cours.',
  },
  {
    titleEn: '13. Intellectual Property',
    titleFr: '13. Propriété intellectuelle',
    contentEn:
      'The Sync/Sit name, logo, design, and all software code and visual elements of the platform are the intellectual property of its operator and are protected by applicable intellectual property laws.\n\n' +
      'You may not copy, modify, distribute, or create derivative works from any part of the platform without prior written consent.\n\n' +
      'Content you upload to the platform (profile photos, documents) remains your property. By uploading content, you grant Sync/Sit a limited, non-exclusive licence to store, display, and process this content solely for the purpose of providing the service.',
    contentFr:
      'Le nom Sync/Sit, le logo, le design et l\'ensemble du code logiciel et des éléments visuels de la plateforme sont la propriété intellectuelle de son exploitant et sont protégés par les lois applicables en matière de propriété intellectuelle.\n\n' +
      'Vous ne pouvez pas copier, modifier, distribuer ou créer des oeuvres dérivées de tout ou partie de la plateforme sans consentement écrit préalable.\n\n' +
      'Le contenu que vous téléchargez sur la plateforme (photos de profil, documents) reste votre propriété. En téléchargeant du contenu, vous accordez à Sync/Sit une licence limitée et non exclusive pour stocker, afficher et traiter ce contenu aux seules fins de fourniture du service.',
  },
  {
    titleEn: '14. Modifications to Terms',
    titleFr: '14. Modifications des conditions',
    contentEn:
      'We may modify these Terms of Service at any time. When we make material changes, we will notify you through the app and update the "Last updated" date at the top of this page.\n\n' +
      'Your continued use of Sync/Sit after the publication of modified terms constitutes acceptance of the changes. If you do not agree with the modified terms, you must stop using the platform and delete your account.\n\n' +
      'We encourage you to review these terms periodically.',
    contentFr:
      'Nous pouvons modifier les présentes Conditions Générales d\'Utilisation à tout moment. En cas de modification substantielle, nous vous en informerons via l\'application et mettrons à jour la date de « Dernière mise à jour » en haut de cette page.\n\n' +
      'Votre utilisation continue de Sync/Sit après la publication des conditions modifiées vaut acceptation des modifications. Si vous n\'acceptez pas les conditions modifiées, vous devez cesser d\'utiliser la plateforme et supprimer votre compte.\n\n' +
      'Nous vous encourageons à consulter régulièrement les présentes conditions.',
  },
  {
    titleEn: '15. Governing Law and Jurisdiction',
    titleFr: '15. Droit applicable et juridiction compétente',
    contentEn:
      'These Terms of Service are governed by and construed in accordance with the laws of France, without regard to conflict of law provisions.\n\n' +
      'Any dispute arising out of or in connection with these terms shall be subject to the exclusive jurisdiction of the courts of Paris, France.\n\n' +
      'In accordance with the provisions of the French Consumer Code (Code de la consommation), you may also have the right to resort to a consumer mediation process before initiating court proceedings.',
    contentFr:
      'Les présentes Conditions Générales d\'Utilisation sont régies par le droit français et interprétées conformément à celui-ci, sans égard aux dispositions relatives aux conflits de lois.\n\n' +
      'Tout litige découlant des présentes conditions ou en rapport avec celles-ci relève de la compétence exclusive des tribunaux de Paris, France.\n\n' +
      'Conformément aux dispositions du Code de la consommation, vous pouvez également avoir le droit de recourir à un processus de médiation de la consommation avant d\'engager une procédure judiciaire.',
  },
  {
    titleEn: '16. Disclaimer of Warranties',
    titleFr: '16. Exclusion de garanties',
    contentEn:
      'Sync/Sit is provided on an "as is" and "as available" basis. To the maximum extent permitted by applicable law, we make no warranties, express or implied, regarding the platform, including but not limited to:\n\n' +
      '- The availability, reliability, or continuity of the service\n' +
      '- The accuracy, completeness, or timeliness of any information on the platform\n' +
      '- The suitability of any babysitter for any particular family or child\n' +
      '- The absence of errors, bugs, or security vulnerabilities\n\n' +
      'The verification processes on Sync/Sit (identity verification, school enrollment verification, community vouching) are designed to enhance trust within the community but do not constitute a guarantee of any user\'s character, reliability, or competence.',
    contentFr:
      'Sync/Sit est fourni « en l\'état » et « selon disponibilité ». Dans la limite maximale autorisée par le droit applicable, nous ne donnons aucune garantie, expresse ou implicite, concernant la plateforme, y compris mais sans s\'y limiter :\n\n' +
      '- La disponibilité, la fiabilité ou la continuité du service\n' +
      '- L\'exactitude, l\'exhaustivité ou l\'actualité des informations présentes sur la plateforme\n' +
      '- L\'adéquation d\'un babysitter pour une famille ou un enfant en particulier\n' +
      '- L\'absence d\'erreurs, de bugs ou de failles de sécurité\n\n' +
      'Les processus de vérification de Sync/Sit (vérification d\'identité, vérification de scolarité, parrainage communautaire) sont conçus pour renforcer la confiance au sein de la communauté mais ne constituent pas une garantie du caractère, de la fiabilité ou des compétences d\'un utilisateur.',
  },
  {
    titleEn: '17. Contact',
    titleFr: '17. Contact',
    contentEn:
      'For any questions about these Terms of Service, please contact us at:\n\n' +
      'Email: support@sync-sit.com',
    contentFr:
      'Pour toute question relative aux présentes Conditions Générales d\'Utilisation, veuillez nous contacter à :\n\n' +
      'E-mail : support@sync-sit.com',
  },
];

export function TermsPage() {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language?.startsWith('fr');

  return (
    <div>
      <TopNav title={t('menu.terms')} backTo="back" />
      <div className="px-6 pt-4 pb-8">
        <h2 className="mb-2 text-xl font-bold">
          {isFr ? 'Conditions Générales d\'Utilisation' : 'Terms of Service'}
        </h2>
        <p className="mb-6 text-xs text-gray-400">
          {isFr ? 'Dernière mise à jour : 2 avril 2026' : 'Last updated: April 2, 2026'}
        </p>

        <div className="space-y-6">
          {sections.map((section, idx) => (
            <div key={idx}>
              <h3 className="mb-2 text-sm font-semibold text-gray-800">
                {isFr ? section.titleFr : section.titleEn}
              </h3>
              <div className="whitespace-pre-line text-sm leading-relaxed text-gray-600">
                {isFr ? section.contentFr : section.contentEn}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
