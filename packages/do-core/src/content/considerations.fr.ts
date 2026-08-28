/**
 * French "things to cover" considerations content (plan §5). Same keys as
 * the EN module — the taxonomy integrity tests pin the two key sets
 * identical. Faithful translations of the §5 V1 content.
 */
export const CONSIDERATIONS_FR: Record<string, string> = {
  // ── 5.1 Green-Thumb ──
  'considerations.green_thumb.access': 'Accès — clés, digicodes, alarme',
  'considerations.green_thumb.absence_dates':
    "Les dates exactes d'absence et la fréquence des passages",
  'considerations.green_thumb.plants_water':
    "Quelles plantes, quelle quantité d'eau, et lesquelles sont délicates",
  'considerations.green_thumb.tools_location':
    "Où se trouvent l'arrosoir, le tuyau et les outils",
  'considerations.green_thumb.outdoor_tap':
    'Accès à un robinet extérieur',
  'considerations.green_thumb.pets_on_site':
    'Animaux présents sur place',
  'considerations.green_thumb.allergies': 'Allergies',
  'considerations.green_thumb.contingency':
    'Que faire si une plante meurt ou si la météo change',
  'considerations.green_thumb.photo_updates':
    'Des photos de suivi sont-elles attendues',
  'considerations.green_thumb.mower_type':
    'Type de tondeuse — thermique ou électrique',
  'considerations.green_thumb.garden_size': 'Taille du jardin',
  'considerations.green_thumb.green_waste': 'Où vont les déchets verts',

  // ── 5.2 Boxes ──
  'considerations.boxes.lifting_floor':
    'Quelle charge à porter, et à quel étage — y a-t-il un ascenseur',
  'considerations.boxes.volume':
    'Combien de pièces ou de cartons, de façon réaliste',
  'considerations.boxes.supplies':
    'Qui fournit les cartons, le ruban adhésif et les étiquettes',
  'considerations.boxes.fragile_items':
    "Les objets fragiles ou de valeur, et qui s'en charge",
  'considerations.boxes.move_date':
    'La date du déménagement est en général non négociable — dites-le',
  'considerations.boxes.duration': 'Une estimation honnête de la durée',
  'considerations.boxes.working_alone':
    "Travail seul ou aux côtés d'autres personnes",
  'considerations.boxes.breakage':
    'Que se passe-t-il si quelque chose casse',
  'considerations.boxes.car_licence':
    'Faut-il une voiture ou un permis',
  'considerations.boxes.gloves_clothing': 'Gants et tenue adaptée',

  // ── 5.3 Ikea ──
  'considerations.ikea.items_models':
    'Combien de meubles et lesquels — liens ou noms de modèles',
  'considerations.ikea.instructions_parts':
    'La notice et toutes les pièces sont-elles vraiment là',
  'considerations.ikea.tools':
    'Quels outils sont sur place et lesquels apporter',
  'considerations.ikea.drilling':
    'Percer les murs : accord du propriétaire, et tuyaux et câbles cachés derrière',
  'considerations.ikea.two_person_items':
    'Quels meubles nécessitent vraiment deux personnes',
  'considerations.ikea.floor_protection': 'Protection du sol',
  'considerations.ikea.packaging':
    'Qui se débarrasse des emballages',
  'considerations.ikea.time_per_item':
    'Un temps réaliste par meuble',
  'considerations.ikea.ladder_ceiling':
    'Escabeau et hauteur sous plafond',

  // ── 5.4 Party ──
  'considerations.party.date_end_time':
    'La date et une heure de fin ferme — une fin tardive implique un retour à la maison et une discussion avec les parents',
  'considerations.party.guest_count_ages':
    "Le nombre d'invités et l'âge des enfants présents",
  'considerations.party.childcare_check':
    "S'agit-il en réalité de garde d'enfants — dans ce cas, ce sont les règles et les ratios de sync-sit qui s'appliquent, pas ceux-ci",
  'considerations.party.alcohol': "Présence d'alcool",
  'considerations.party.food_allergies':
    'Manipulation des aliments et allergies',
  'considerations.party.dress_code': 'Code vestimentaire',
  'considerations.party.student_fed': "L'étudiant est-il nourri",
  'considerations.party.other_helpers': "Qui d'autre aide",
  'considerations.party.adult_present':
    'Un adulte est-il présent en permanence',
  'considerations.party.neighbours_noise': 'Voisins et bruit',
  'considerations.party.arrival_time':
    'À quelle heure arriver avant les invités',

  // ── 5.5 IT ──
  'considerations.it.passwords':
    "Mots de passe — la famille les saisit elle-même, l'étudiant ne les recueille ni ne les conserve jamais",
  'considerations.it.personal_data':
    "Quelles données personnelles l'étudiant pourra voir",
  'considerations.it.backup_first':
    'Sauvegarder avant toute modification',
  'considerations.it.device_details':
    "Marque, système, modèle et âge de l'appareil",
  'considerations.it.warranty':
    'Le travail annule-t-il une garantie',
  'considerations.it.account_ownership':
    'À qui appartient le compte concerné',
  'considerations.it.no_purchases':
    'Aucun achat au nom de la famille',
  'considerations.it.remote_or_in_person': 'À distance ou sur place',
  'considerations.it.concrete_outcome':
    'Convenir d\'un résultat concret, pas « rendre ça plus rapide »',
  'considerations.it.written_summary':
    'Un court résumé écrit de ce qui a été modifié',

  // ── 5.6 Errands ──
  'considerations.errands.money_mechanism':
    "Comment fonctionne l'argent — carte prépayée, espèces remises et comptées, ou remboursement sur ticket",
  'considerations.errands.keep_receipt':
    'Toujours garder le ticket de caisse',
  'considerations.errands.out_of_stock':
    'Que faire si un article est en rupture — remplacer ou passer',
  'considerations.errands.prescriptions_id':
    "Ordonnances et pièce d'identité exigée en pharmacie",
  'considerations.errands.spending_ceiling': 'Plafond de dépenses',
  'considerations.errands.distance_transport':
    'Quelle distance, et avec quel moyen de transport',
  'considerations.errands.cold_chain':
    'Chaîne du froid pour les produits surgelés ou frais',
  'considerations.errands.load_weight': 'Quel poids à porter',
  'considerations.errands.nobody_home':
    "Où déposer les courses si personne n'est là",

  // ── 5.7 Pet & house-sitting ──
  'considerations.pet_house.animal_profile':
    "L'animal — espèce, race, taille, âge, tempérament, et a-t-il déjà mordu ou fugué",
  'considerations.pet_house.feeding_routine':
    'La routine de repas exacte et les quantités',
  'considerations.pet_house.medication': 'Traitements médicaux',
  'considerations.pet_house.lead_harness_walk':
    'Laisse, harnais et où promener',
  'considerations.pet_house.behaviour':
    'Comportement avec les autres chiens et avec les inconnus',
  'considerations.pet_house.vet_authorisation':
    'Le nom et le numéro du vétérinaire, et qui autorise les soins et qui paie',
  'considerations.pet_house.access': 'Clés, digicodes et alarme',
  'considerations.pet_house.emergency':
    'Ce qui compte comme une urgence et qui appeler en premier',
  'considerations.pet_house.neighbours': 'Voisins à prévenir',
  'considerations.pet_house.insurance': 'Assurance, le cas échéant',
};
