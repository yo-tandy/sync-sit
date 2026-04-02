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
    titleEn: '1. Data Controller',
    titleFr: '1. Responsable du traitement',
    contentEn:
      'Sync/Sit is operated by a private individual based in Paris, France. The data controller within the meaning of the General Data Protection Regulation (GDPR) and the French Data Protection Act (Loi Informatique et Libertés) can be contacted at: support@sync-sit.com.\n\nSync/Sit is not a registered company. It is a non-commercial platform designed to connect families and student babysitters within the École Jeannine Manuel (EJM) community in Paris.',
    contentFr:
      'Sync/Sit est exploité par une personne physique domiciliée à Paris, France. Le responsable du traitement au sens du Règlement Général sur la Protection des Données (RGPD) et de la loi Informatique et Libertés est joignable à l\'adresse : support@sync-sit.com.\n\nSync/Sit n\'est pas une société immatriculée. Il s\'agit d\'une plateforme non commerciale destinée à mettre en relation les familles et les élèves babysitters au sein de la communauté de l\'École Jeannine Manuel (EJM) à Paris.',
  },
  {
    titleEn: '2. Personal Data Collected',
    titleFr: '2. Données personnelles collectées',
    contentEn:
      'We collect the following categories of personal data:\n\n' +
      '- Identity data: first name, last name, date of birth\n' +
      '- Contact data: email address, phone number, residential address (including GPS coordinates for proximity-based search)\n' +
      '- Profile data: profile photo, biography, spoken languages\n' +
      '- Verification documents: government-issued ID scans (for babysitters), school enrollment certificates\n' +
      '- Children\'s data: first names, ages, and spoken languages of children in parent profiles\n' +
      '- Scheduling data: babysitter availability, appointment history\n' +
      '- References: names and contact details of references provided by babysitters\n' +
      '- Community verification data: vouching records from other verified members\n' +
      '- Technical data: Firebase Cloud Messaging (FCM) tokens for push notifications\n' +
      '- Authentication data: email-based authentication tokens managed by Firebase Auth',
    contentFr:
      'Nous collectons les catégories de données personnelles suivantes :\n\n' +
      '- Données d\'identité : prénom, nom, date de naissance\n' +
      '- Données de contact : adresse e-mail, numéro de téléphone, adresse postale (y compris les coordonnées GPS pour la recherche de proximité)\n' +
      '- Données de profil : photo de profil, biographie, langues parlées\n' +
      '- Documents de vérification : copie d\'une pièce d\'identité officielle (pour les babysitters), certificat de scolarité\n' +
      '- Données relatives aux enfants : prénoms, âges et langues parlées des enfants figurant dans les profils des parents\n' +
      '- Données de planification : disponibilités des babysitters, historique des rendez-vous\n' +
      '- Références : noms et coordonnées des personnes de référence fournies par les babysitters\n' +
      '- Données de vérification communautaire : attestations de parrainage par d\'autres membres vérifiés\n' +
      '- Données techniques : jetons Firebase Cloud Messaging (FCM) pour les notifications push\n' +
      '- Données d\'authentification : jetons d\'authentification par e-mail gérés par Firebase Auth',
  },
  {
    titleEn: '3. Purposes of Processing',
    titleFr: '3. Finalités du traitement',
    contentEn:
      'Your personal data is processed for the following purposes:\n\n' +
      '- Account creation and management: to create, maintain, and authenticate your account\n' +
      '- Matching and search: to enable parents to find babysitters near their home and matching their scheduling needs\n' +
      '- Identity verification: to verify the identity and school affiliation of babysitters for the safety of families and children\n' +
      '- Community verification: to facilitate peer vouching between verified community members\n' +
      '- Communication: to send transactional emails (verification codes, appointment confirmations) and push notifications\n' +
      '- Safety and trust: to verify that babysitters are enrolled EJM students and are of the required age\n' +
      '- Administration: to allow platform administrators to review verification requests and manage user accounts',
    contentFr:
      'Vos données personnelles sont traitées aux fins suivantes :\n\n' +
      '- Création et gestion de compte : pour créer, maintenir et authentifier votre compte\n' +
      '- Mise en relation et recherche : pour permettre aux parents de trouver des babysitters à proximité de leur domicile et correspondant à leurs besoins de disponibilité\n' +
      '- Vérification d\'identité : pour vérifier l\'identité et l\'affiliation scolaire des babysitters afin d\'assurer la sécurité des familles et des enfants\n' +
      '- Vérification communautaire : pour faciliter le parrainage entre membres vérifiés de la communauté\n' +
      '- Communication : pour envoyer des e-mails transactionnels (codes de vérification, confirmations de rendez-vous) et des notifications push\n' +
      '- Sécurité et confiance : pour vérifier que les babysitters sont bien des élèves inscrits à l\'EJM et ont l\'âge requis\n' +
      '- Administration : pour permettre aux administrateurs de la plateforme d\'examiner les demandes de vérification et de gérer les comptes utilisateurs',
  },
  {
    titleEn: '4. Legal Basis for Processing',
    titleFr: '4. Base légale du traitement',
    contentEn:
      'We process your data on the following legal grounds under Article 6 of the GDPR:\n\n' +
      '- Consent (Article 6(1)(a)): you provide explicit consent when you create your account and accept this privacy policy. You may withdraw consent at any time by deleting your account or contacting us.\n' +
      '- Contract performance (Article 6(1)(b)): processing is necessary to provide the services you signed up for, including matching, scheduling, and communication features.\n' +
      '- Legitimate interest (Article 6(1)(f)): we have a legitimate interest in verifying the identity and school affiliation of babysitters to ensure the safety of children and families using the platform. This includes collecting and reviewing ID documents and school enrollment certificates.\n\n' +
      'For children\'s data (names and ages), we rely on parental consent provided by the parent who creates the account and enters this information.',
    contentFr:
      'Nous traitons vos données sur les bases légales suivantes au titre de l\'article 6 du RGPD :\n\n' +
      '- Consentement (article 6, paragraphe 1, point a) : vous donnez votre consentement explicite lors de la création de votre compte et de l\'acceptation de la présente politique de confidentialité. Vous pouvez retirer votre consentement à tout moment en supprimant votre compte ou en nous contactant.\n' +
      '- Exécution du contrat (article 6, paragraphe 1, point b) : le traitement est nécessaire à la fourniture des services auxquels vous vous êtes inscrit(e), y compris les fonctionnalités de mise en relation, de planification et de communication.\n' +
      '- Intérêt légitime (article 6, paragraphe 1, point f) : nous avons un intérêt légitime à vérifier l\'identité et l\'affiliation scolaire des babysitters afin de garantir la sécurité des enfants et des familles utilisant la plateforme. Cela inclut la collecte et l\'examen de copies de pièces d\'identité et de certificats de scolarité.\n\n' +
      'Pour les données relatives aux enfants (prénoms et âges), nous nous fondons sur le consentement parental donné par le parent qui crée le compte et saisit ces informations.',
  },
  {
    titleEn: '5. Data Recipients',
    titleFr: '5. Destinataires des données',
    contentEn:
      'Your personal data may be shared with or accessed by the following recipients:\n\n' +
      '- Platform administrators: for verification review (ID documents, school certificates) and user account management\n' +
      '- Other users: your profile information (name, photo, bio, languages, availability) is visible to other verified users of the platform. Your address is not displayed; only approximate distance is shown.\n' +
      '- Google LLC (Firebase): provides hosting, database (Firestore), authentication, file storage (Cloud Storage), and push notification services (FCM). Data is stored in the EU region (europe-west1).\n' +
      '- Resend Inc.: provides transactional email delivery for verification codes, appointment notifications, and account-related communications.\n\n' +
      'We do not sell, rent, or trade your personal data to any third party. We do not use your data for advertising or marketing purposes.',
    contentFr:
      'Vos données personnelles peuvent être partagées avec ou consultées par les destinataires suivants :\n\n' +
      '- Administrateurs de la plateforme : pour l\'examen des vérifications (pièces d\'identité, certificats de scolarité) et la gestion des comptes utilisateurs\n' +
      '- Autres utilisateurs : vos informations de profil (nom, photo, biographie, langues, disponibilités) sont visibles par les autres utilisateurs vérifiés de la plateforme. Votre adresse n\'est pas affichée ; seule une distance approximative est indiquée.\n' +
      '- Google LLC (Firebase) : fournit l\'hébergement, la base de données (Firestore), l\'authentification, le stockage de fichiers (Cloud Storage) et les services de notifications push (FCM). Les données sont stockées dans la région UE (europe-west1).\n' +
      '- Resend Inc. : fournit le service d\'envoi d\'e-mails transactionnels pour les codes de vérification, les notifications de rendez-vous et les communications liées aux comptes.\n\n' +
      'Nous ne vendons, ne louons et ne commercialisons aucune de vos données personnelles auprès de tiers. Nous n\'utilisons pas vos données à des fins publicitaires ou commerciales.',
  },
  {
    titleEn: '6. Data Transfers Outside the EU',
    titleFr: '6. Transferts de données hors de l\'UE',
    contentEn:
      'Your data is primarily stored and processed within the European Union (Firebase europe-west1 region). However, some processing by Google LLC and Resend Inc. may involve transfers to the United States.\n\n' +
      'These transfers are governed by appropriate safeguards in compliance with the GDPR, including:\n' +
      '- Standard Contractual Clauses (SCCs) adopted by the European Commission\n' +
      '- The EU-US Data Privacy Framework where applicable\n\n' +
      'You may request a copy of the applicable safeguards by contacting us at support@sync-sit.com.',
    contentFr:
      'Vos données sont principalement stockées et traitées au sein de l\'Union européenne (région Firebase europe-west1). Toutefois, certains traitements effectués par Google LLC et Resend Inc. peuvent impliquer des transferts vers les États-Unis.\n\n' +
      'Ces transferts sont encadrés par des garanties appropriées conformément au RGPD, notamment :\n' +
      '- Les Clauses Contractuelles Types (CCT) adoptées par la Commission européenne\n' +
      '- Le cadre de protection des données UE-États-Unis (Data Privacy Framework), le cas échéant\n\n' +
      'Vous pouvez demander une copie des garanties applicables en nous contactant à support@sync-sit.com.',
  },
  {
    titleEn: '7. Data Retention',
    titleFr: '7. Durée de conservation',
    contentEn:
      'We retain your personal data for the following periods:\n\n' +
      '- Active account data (profile, children, schedule, documents): retained as long as your account is active. Deleted promptly upon account deletion request.\n' +
      '- Notifications and audit logs: retained for 30 days, then automatically deleted\n' +
      '- Cancelled appointment records: retained for 30 days, then automatically deleted\n' +
      '- Expired verification codes and magic links: deleted immediately upon expiration\n' +
      '- Verification documents (ID scans, school certificates): retained for the duration of account activity. Deleted upon account deletion.\n' +
      '- FCM tokens: retained while the account is active, deleted upon logout or account deletion\n\n' +
      'When you delete your account, all associated personal data is permanently erased from our systems (hard deletion). This includes your profile, documents, verification records, and children\'s data.',
    contentFr:
      'Nous conservons vos données personnelles pendant les durées suivantes :\n\n' +
      '- Données de compte actif (profil, enfants, planification, documents) : conservées tant que votre compte est actif. Supprimées dans les meilleurs délais suite à une demande de suppression de compte.\n' +
      '- Notifications et journaux d\'audit : conservés pendant 30 jours, puis automatiquement supprimés\n' +
      '- Enregistrements de rendez-vous annulés : conservés pendant 30 jours, puis automatiquement supprimés\n' +
      '- Codes de vérification et liens magiques expirés : supprimés immédiatement à l\'expiration\n' +
      '- Documents de vérification (copies de pièces d\'identité, certificats de scolarité) : conservés pendant toute la durée d\'activité du compte. Supprimés lors de la suppression du compte.\n' +
      '- Jetons FCM : conservés tant que le compte est actif, supprimés lors de la déconnexion ou de la suppression du compte\n\n' +
      'Lorsque vous supprimez votre compte, toutes les données personnelles associées sont définitivement effacées de nos systèmes (suppression irréversible). Cela inclut votre profil, vos documents, vos enregistrements de vérification et les données relatives à vos enfants.',
  },
  {
    titleEn: '8. Your Rights Under GDPR',
    titleFr: '8. Vos droits en vertu du RGPD',
    contentEn:
      'Under the GDPR and French data protection law, you have the following rights regarding your personal data:\n\n' +
      '- Right of access (Article 15): you may request a copy of all personal data we hold about you\n' +
      '- Right to rectification (Article 16): you may request correction of inaccurate or incomplete data\n' +
      '- Right to erasure (Article 17): you may request deletion of your personal data. You can do this directly by deleting your account in the app, or by contacting us.\n' +
      '- Right to data portability (Article 20): you may request your data in a structured, machine-readable format. An in-app export feature is available in your account settings.\n' +
      '- Right to restriction of processing (Article 18): you may request that we limit the processing of your data in certain circumstances\n' +
      '- Right to object (Article 21): you may object to processing based on legitimate interest\n' +
      '- Right to withdraw consent: you may withdraw your consent at any time, without affecting the lawfulness of processing carried out prior to withdrawal\n\n' +
      'To exercise any of these rights, you may:\n' +
      '- Use the in-app data export and account deletion features in your profile settings\n' +
      '- Contact us at support@sync-sit.com\n\n' +
      'We will respond to your request within 30 days. If you believe your rights have not been respected, you have the right to lodge a complaint with the Commission Nationale de l\'Informatique et des Libertés (CNIL), the French data protection authority: www.cnil.fr.',
    contentFr:
      'En vertu du RGPD et de la loi française sur la protection des données, vous disposez des droits suivants concernant vos données personnelles :\n\n' +
      '- Droit d\'accès (article 15) : vous pouvez demander une copie de l\'ensemble des données personnelles que nous détenons à votre sujet\n' +
      '- Droit de rectification (article 16) : vous pouvez demander la correction de données inexactes ou incomplètes\n' +
      '- Droit à l\'effacement (article 17) : vous pouvez demander la suppression de vos données personnelles. Vous pouvez le faire directement en supprimant votre compte dans l\'application, ou en nous contactant.\n' +
      '- Droit à la portabilité des données (article 20) : vous pouvez demander vos données dans un format structuré et lisible par machine. Une fonctionnalité d\'export est disponible dans les paramètres de votre compte.\n' +
      '- Droit à la limitation du traitement (article 18) : vous pouvez demander la limitation du traitement de vos données dans certaines circonstances\n' +
      '- Droit d\'opposition (article 21) : vous pouvez vous opposer au traitement fondé sur l\'intérêt légitime\n' +
      '- Droit de retrait du consentement : vous pouvez retirer votre consentement à tout moment, sans que cela n\'affecte la licéité du traitement effectué avant le retrait\n\n' +
      'Pour exercer l\'un de ces droits, vous pouvez :\n' +
      '- Utiliser les fonctionnalités d\'export de données et de suppression de compte disponibles dans les paramètres de votre profil\n' +
      '- Nous contacter à support@sync-sit.com\n\n' +
      'Nous répondrons à votre demande dans un délai de 30 jours. Si vous estimez que vos droits n\'ont pas été respectés, vous avez le droit d\'introduire une réclamation auprès de la Commission Nationale de l\'Informatique et des Libertés (CNIL), autorité française de protection des données : www.cnil.fr.',
  },
  {
    titleEn: '9. Children\'s Data',
    titleFr: '9. Données relatives aux enfants',
    contentEn:
      'Sync/Sit collects limited data about children for the sole purpose of facilitating babysitting arrangements. This data consists of first names, ages, and spoken languages of children, and is entered exclusively by their parent or legal guardian.\n\n' +
      'We do not collect data directly from children. All children\'s data is provided with parental consent as part of the parent\'s account creation and profile management.\n\n' +
      'Children\'s data is visible only to verified babysitters on the platform and platform administrators. It is deleted immediately when the parent deletes their account.\n\n' +
      'Babysitters on Sync/Sit may be minors aged 15 to 18. In accordance with Article 8 of the GDPR and French law (which sets the age of digital consent at 15), babysitter accounts for users aged 15 and older are created with the babysitter\'s own consent. No parental consent is required for these users under French law.',
    contentFr:
      'Sync/Sit collecte des données limitées concernant les enfants dans le seul but de faciliter l\'organisation de gardes d\'enfants. Ces données consistent en les prénoms, âges et langues parlées des enfants, et sont saisies exclusivement par leur parent ou représentant légal.\n\n' +
      'Nous ne collectons aucune donnée directement auprès des enfants. Toutes les données relatives aux enfants sont fournies avec le consentement parental dans le cadre de la création du compte et de la gestion du profil du parent.\n\n' +
      'Les données des enfants ne sont visibles que par les babysitters vérifiés sur la plateforme et les administrateurs. Elles sont supprimées immédiatement lorsque le parent supprime son compte.\n\n' +
      'Les babysitters sur Sync/Sit peuvent être des mineurs âgés de 15 à 18 ans. Conformément à l\'article 8 du RGPD et au droit français (qui fixe l\'âge du consentement numérique à 15 ans), les comptes de babysitters pour les utilisateurs de 15 ans et plus sont créés avec le consentement propre du babysitter. Aucun consentement parental n\'est requis pour ces utilisateurs en vertu du droit français.',
  },
  {
    titleEn: '10. Security Measures',
    titleFr: '10. Mesures de sécurité',
    contentEn:
      'We implement appropriate technical and organisational measures to protect your personal data, including:\n\n' +
      '- Authentication via Firebase Auth with email-based magic links (no passwords stored)\n' +
      '- All data transmitted over encrypted HTTPS connections (TLS)\n' +
      '- Role-based access control: only administrators can access verification documents and manage accounts\n' +
      '- Firestore security rules restricting data access based on user role and ownership\n' +
      '- Verification requirements: babysitters must provide a valid EJM email address, government ID, and school enrollment proof before their profiles are published\n' +
      '- Secure file storage via Firebase Cloud Storage with restricted access rules\n\n' +
      'While we take reasonable steps to protect your data, no system is completely secure. We encourage you to use a secure email provider and to contact us immediately at support@sync-sit.com if you suspect any unauthorised access to your account.',
    contentFr:
      'Nous mettons en oeuvre des mesures techniques et organisationnelles appropriées pour protéger vos données personnelles, notamment :\n\n' +
      '- Authentification via Firebase Auth par liens magiques envoyés par e-mail (aucun mot de passe stocké)\n' +
      '- Toutes les données transmises via des connexions HTTPS chiffrées (TLS)\n' +
      '- Contrôle d\'accès basé sur les rôles : seuls les administrateurs peuvent accéder aux documents de vérification et gérer les comptes\n' +
      '- Règles de sécurité Firestore limitant l\'accès aux données en fonction du rôle et de la propriété de l\'utilisateur\n' +
      '- Exigences de vérification : les babysitters doivent fournir une adresse e-mail EJM valide, une pièce d\'identité officielle et un justificatif de scolarité avant la publication de leur profil\n' +
      '- Stockage sécurisé des fichiers via Firebase Cloud Storage avec des règles d\'accès restreintes\n\n' +
      'Bien que nous prenions des mesures raisonnables pour protéger vos données, aucun système n\'est totalement infaillible. Nous vous encourageons à utiliser un fournisseur de messagerie sécurisé et à nous contacter immédiatement à support@sync-sit.com si vous soupçonnez un accès non autorisé à votre compte.',
  },
  {
    titleEn: '11. Cookies and Local Storage',
    titleFr: '11. Cookies et stockage local',
    contentEn:
      'Sync/Sit does not use cookies.\n\n' +
      'We use browser local storage (localStorage) exclusively for the following purposes:\n' +
      '- Storing your language preference (English or French)\n' +
      '- Storing a limited error log for troubleshooting (recent client-side errors, automatically cleared)\n\n' +
      'This data remains on your device and is not transmitted to our servers. Firebase Auth may use local storage or IndexedDB to maintain your authentication session; this is managed by Firebase and is necessary for the service to function.',
    contentFr:
      'Sync/Sit n\'utilise pas de cookies.\n\n' +
      'Nous utilisons le stockage local du navigateur (localStorage) exclusivement aux fins suivantes :\n' +
      '- Stockage de votre préférence linguistique (anglais ou français)\n' +
      '- Stockage d\'un journal d\'erreurs limité pour le dépannage (erreurs récentes côté client, automatiquement effacé)\n\n' +
      'Ces données restent sur votre appareil et ne sont pas transmises à nos serveurs. Firebase Auth peut utiliser le stockage local ou IndexedDB pour maintenir votre session d\'authentification ; cela est géré par Firebase et est nécessaire au fonctionnement du service.',
  },
  {
    titleEn: '12. Community Verification',
    titleFr: '12. Vérification communautaire',
    contentEn:
      'Sync/Sit includes a community verification feature that allows verified members to vouch for other users they know personally. When a member vouches for another user:\n\n' +
      '- The vouching member\'s name is recorded and may be visible to administrators\n' +
      '- The fact that a user has been vouched for (and the number of vouches) may be visible on their profile\n' +
      '- The identity of the vouching member is not disclosed to other regular users\n\n' +
      'Community vouching is voluntary. By vouching for another user, you confirm that you know them personally and believe they are a trustworthy member of the EJM community.',
    contentFr:
      'Sync/Sit inclut une fonctionnalité de vérification communautaire qui permet aux membres vérifiés de se porter garants d\'autres utilisateurs qu\'ils connaissent personnellement. Lorsqu\'un membre se porte garant d\'un autre utilisateur :\n\n' +
      '- Le nom du membre garant est enregistré et peut être visible par les administrateurs\n' +
      '- Le fait qu\'un utilisateur ait été parrainé (et le nombre de parrainages) peut être visible sur son profil\n' +
      '- L\'identité du membre garant n\'est pas divulguée aux autres utilisateurs ordinaires\n\n' +
      'Le parrainage communautaire est volontaire. En vous portant garant d\'un autre utilisateur, vous confirmez que vous le connaissez personnellement et que vous le considérez comme un membre digne de confiance de la communauté EJM.',
  },
  {
    titleEn: '13. Verification Documents',
    titleFr: '13. Documents de vérification',
    contentEn:
      'Babysitters are required to submit identity documents (government-issued ID scan) and school enrollment certificates as part of the verification process. These documents are:\n\n' +
      '- Uploaded securely to Firebase Cloud Storage with restricted access\n' +
      '- Accessible only to platform administrators for the purpose of identity and enrollment verification\n' +
      '- Not shared with other users or third parties\n' +
      '- Permanently deleted when the babysitter\'s account is deleted\n\n' +
      'Administrators review these documents solely to confirm that babysitters are current EJM students and that their identity matches their profile information.',
    contentFr:
      'Les babysitters doivent soumettre des documents d\'identité (copie d\'une pièce d\'identité officielle) et des certificats de scolarité dans le cadre du processus de vérification. Ces documents sont :\n\n' +
      '- Téléchargés de manière sécurisée sur Firebase Cloud Storage avec un accès restreint\n' +
      '- Accessibles uniquement aux administrateurs de la plateforme à des fins de vérification d\'identité et de scolarité\n' +
      '- Non partagés avec d\'autres utilisateurs ou des tiers\n' +
      '- Définitivement supprimés lors de la suppression du compte du babysitter\n\n' +
      'Les administrateurs examinent ces documents uniquement pour confirmer que les babysitters sont des élèves actuellement inscrits à l\'EJM et que leur identité correspond aux informations de leur profil.',
  },
  {
    titleEn: '14. Changes to This Policy',
    titleFr: '14. Modifications de la présente politique',
    contentEn:
      'We may update this privacy policy from time to time to reflect changes to our practices or for legal, regulatory, or operational reasons. When we make material changes, we will notify you through the app.\n\n' +
      'The "Last updated" date at the top of this policy indicates when the most recent revision was made. We encourage you to review this policy periodically.\n\n' +
      'Your continued use of Sync/Sit after any changes to this policy constitutes your acceptance of the updated terms.',
    contentFr:
      'Nous pouvons mettre à jour la présente politique de confidentialité de temps à autre pour refléter des changements dans nos pratiques ou pour des raisons juridiques, réglementaires ou opérationnelles. En cas de modification substantielle, nous vous en informerons via l\'application.\n\n' +
      'La date de « Dernière mise à jour » en haut de cette politique indique la date de la révision la plus récente. Nous vous encourageons à consulter régulièrement cette politique.\n\n' +
      'Votre utilisation continue de Sync/Sit après toute modification de la présente politique vaut acceptation des conditions mises à jour.',
  },
  {
    titleEn: '15. Contact',
    titleFr: '15. Contact',
    contentEn:
      'For any questions about this privacy policy, or to exercise your data protection rights, please contact us at:\n\n' +
      'Email: support@sync-sit.com\n\n' +
      'You also have the right to lodge a complaint with the CNIL:\n' +
      'Commission Nationale de l\'Informatique et des Libertés\n' +
      '3 Place de Fontenoy, TSA 80715\n' +
      '75334 Paris Cedex 07\n' +
      'www.cnil.fr',
    contentFr:
      'Pour toute question relative à la présente politique de confidentialité, ou pour exercer vos droits en matière de protection des données, veuillez nous contacter à :\n\n' +
      'E-mail : support@sync-sit.com\n\n' +
      'Vous disposez également du droit d\'introduire une réclamation auprès de la CNIL :\n' +
      'Commission Nationale de l\'Informatique et des Libertés\n' +
      '3 Place de Fontenoy, TSA 80715\n' +
      '75334 Paris Cedex 07\n' +
      'www.cnil.fr',
  },
];

export function PrivacyPage() {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language?.startsWith('fr');

  return (
    <div>
      <TopNav title={t('menu.privacyPolicy')} backTo="back" />
      <div className="px-6 pt-4 pb-8">
        <h2 className="mb-2 text-xl font-bold">
          {isFr ? 'Politique de confidentialité' : 'Privacy Policy'}
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
