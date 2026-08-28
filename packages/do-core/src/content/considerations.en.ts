/**
 * English "things to cover" considerations content (plan §5). Rendered in
 * three places: beside the family's description box while posting (hints —
 * never pre-filling or constraining the free text), on the task detail a
 * student sees ("what to ask before offering"), and as an optional pre-start
 * checklist on the assigned task for both sides.
 *
 * These lines are the operational face of the §11.5 liability stance
 * ("what happens if something breaks", "who authorises treatment and pays",
 * "does this void a warranty") and should not be softened.
 */
export const CONSIDERATIONS_EN: Record<string, string> = {
  // ── 5.1 Green-Thumb ──
  'considerations.green_thumb.access': 'Access — keys, door codes, alarm',
  'considerations.green_thumb.absence_dates':
    'The exact absence dates and how often to come',
  'considerations.green_thumb.plants_water':
    'Which plants, how much water, and which ones are fussy',
  'considerations.green_thumb.tools_location':
    'Where the watering can, hose and tools live',
  'considerations.green_thumb.outdoor_tap': 'Outdoor tap access',
  'considerations.green_thumb.pets_on_site': 'Pets on site',
  'considerations.green_thumb.allergies': 'Allergies',
  'considerations.green_thumb.contingency':
    'What to do if something dies or the weather turns',
  'considerations.green_thumb.photo_updates':
    'Whether photo updates are expected',
  'considerations.green_thumb.mower_type': 'Mower type — petrol or electric',
  'considerations.green_thumb.garden_size': 'Garden size',
  'considerations.green_thumb.green_waste': 'Where green waste goes',

  // ── 5.2 Boxes ──
  'considerations.boxes.lifting_floor':
    'How much lifting, and which floor — is there a lift',
  'considerations.boxes.volume': 'How many rooms or boxes, realistically',
  'considerations.boxes.supplies': 'Who supplies boxes, tape and labels',
  'considerations.boxes.fragile_items':
    'Fragile or valuable items and who handles them',
  'considerations.boxes.move_date':
    'The move date is usually immovable — say so',
  'considerations.boxes.duration': 'An honest duration estimate',
  'considerations.boxes.working_alone': 'Working alone or alongside others',
  'considerations.boxes.breakage': 'What happens if something breaks',
  'considerations.boxes.car_licence': 'Whether a car or licence is needed',
  'considerations.boxes.gloves_clothing': 'Gloves and suitable clothing',

  // ── 5.3 Ikea ──
  'considerations.ikea.items_models':
    'How many items and which — links or model names',
  'considerations.ikea.instructions_parts':
    'Are the instructions and all the parts actually there',
  'considerations.ikea.tools': 'Which tools are on site vs bring-your-own',
  'considerations.ikea.drilling':
    'Drilling into walls: landlord permission, and pipes and cables behind them',
  'considerations.ikea.two_person_items':
    'Which items genuinely need two people',
  'considerations.ikea.floor_protection': 'Floor protection',
  'considerations.ikea.packaging': 'Who disposes of the packaging',
  'considerations.ikea.time_per_item': 'A realistic time per item',
  'considerations.ikea.ladder_ceiling': 'Ladder and ceiling height',

  // ── 5.4 Party ──
  'considerations.party.date_end_time':
    'The date and a hard end time — a late finish means transport home and a guardian conversation',
  'considerations.party.guest_count_ages':
    'Guest count and the ages of any children',
  'considerations.party.childcare_check':
    "Whether this is actually child supervision — in which case sync-sit's rules and ratios are the right frame, not this one",
  'considerations.party.alcohol': 'Alcohol present',
  'considerations.party.food_allergies': 'Food handling and allergies',
  'considerations.party.dress_code': 'Dress code',
  'considerations.party.student_fed': 'Is the student fed',
  'considerations.party.other_helpers': 'Who else is helping',
  'considerations.party.adult_present': 'Is an adult present throughout',
  'considerations.party.neighbours_noise': 'Neighbours and noise',
  'considerations.party.arrival_time': 'What time to arrive before guests',

  // ── 5.5 IT ──
  'considerations.it.passwords':
    'Passwords — the family types them, the student never collects or keeps them',
  'considerations.it.personal_data':
    'What personal data the student will be able to see',
  'considerations.it.backup_first': 'Back up before changing anything',
  'considerations.it.device_details':
    'Brand, OS, model and age of the device',
  'considerations.it.warranty': 'Whether the work voids a warranty',
  'considerations.it.account_ownership':
    'Who owns the account being touched',
  'considerations.it.no_purchases': "No purchases on the family's behalf",
  'considerations.it.remote_or_in_person': 'Remote or in person',
  'considerations.it.concrete_outcome':
    'Agree a concrete outcome, not "make it faster"',
  'considerations.it.written_summary':
    'A short written summary of what changed',

  // ── 5.6 Errands ──
  'considerations.errands.money_mechanism':
    'How the money works — a pre-paid card, cash handed over and counted, or reimbursement on a receipt',
  'considerations.errands.keep_receipt': 'Always keep the receipt',
  'considerations.errands.out_of_stock':
    'What to do when an item is out of stock — substitute or skip',
  'considerations.errands.prescriptions_id':
    'Prescriptions and pharmacy ID requirements',
  'considerations.errands.spending_ceiling': 'Spending ceiling',
  'considerations.errands.distance_transport':
    'How far, and by what transport',
  'considerations.errands.cold_chain':
    'Cold chain for frozen or fresh items',
  'considerations.errands.load_weight': 'How heavy the load will be',
  'considerations.errands.nobody_home':
    'Where to leave things if nobody is home',

  // ── 5.7 Pet & house-sitting ──
  'considerations.pet_house.animal_profile':
    'The animal — species, breed, size, age, temperament, and whether it has ever bitten or bolted',
  'considerations.pet_house.feeding_routine':
    'The exact feeding routine and quantities',
  'considerations.pet_house.medication': 'Medication',
  'considerations.pet_house.lead_harness_walk':
    'Lead, harness and where to walk',
  'considerations.pet_house.behaviour':
    'Behaviour with other dogs and with strangers',
  'considerations.pet_house.vet_authorisation':
    "The vet's name, number, and who authorises treatment and pays",
  'considerations.pet_house.access': 'Keys, door codes and alarm',
  'considerations.pet_house.emergency':
    'What counts as an emergency and who to call first',
  'considerations.pet_house.neighbours': 'Neighbours to notify',
  'considerations.pet_house.insurance': 'Insurance, if any',
};
