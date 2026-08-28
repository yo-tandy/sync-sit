/**
 * sync-do category taxonomy (plan §4.3, §5). Seven categories, each with
 * sub-categories carrying a curated "things to cover" considerations list.
 * The taxonomy is CONTENT, not schema: adding a sub-category or editing a
 * consideration list is an i18n string change with no migration. The
 * description field on the task stays free text (decision 5).
 *
 * Overnight house-sitting is deliberately ABSENT (decision 13): removed
 * from the taxonomy entirely, not deferred.
 */

export type TaskCategory =
  | 'green_thumb'
  | 'boxes'
  | 'ikea'
  | 'party'
  | 'it'
  | 'errands'
  | 'pet_house';

/** All seven V1 categories (decisions 5, 6), in board display order. */
export const TASK_CATEGORIES: readonly TaskCategory[] = [
  'green_thumb',
  'boxes',
  'ikea',
  'party',
  'it',
  'errands',
  'pet_house',
] as const;

/**
 * Deeply readonly on purpose: `flags.guardianConsent` is what
 * `requiresGuardianConsent` reads to stand up the §6.2 consent gate, and the
 * per-category consideration lists are SHARED array instances across a
 * category's sub-categories — a mutable field would let one `push` rewrite
 * every sibling. The readonly members make the trust boundary explicit at
 * compile time, at no runtime cost.
 */
export interface SubCategoryDef {
  readonly key: string; // e.g. 'ikea_assembly'
  readonly category: TaskCategory;
  /** i18n keys for the "things to cover" list — EN + FR in do-core's content
   *  module (`content/considerations.{en,fr}.ts`), rendered in three places
   *  (§5): posting hints, task detail, assigned-task checklist. */
  readonly considerationKeys: readonly string[];
  readonly flags: {
    /** Sub-category is flagged: a governed student's supervising parent must
     *  approve the offer before the family sees it (decision 7). */
    readonly guardianConsent?: boolean;
    /** The posting form nudges the family toward adultPresent: 'yes'. */
    readonly recommendAdultPresent?: boolean;
    /** Student would handle the family's money or card — the Errands policy. */
    readonly handlesFamilyMoney?: boolean;
    /** A living creature depends on this being done. */
    readonly livingCreature?: boolean;
    /** Transport is usually required. */
    readonly transport?: boolean;
  };
}

// ── Per-category consideration key lists (§5). The plan curates the
// "things to cover" content per CATEGORY; every sub-category of a category
// carries the full category list (the per-sub-category field keeps future
// divergence additive). Content strings live in content/considerations.*.ts.

const GREEN_THUMB_CONSIDERATIONS: readonly string[] = [
  'considerations.green_thumb.access',
  'considerations.green_thumb.absence_dates',
  'considerations.green_thumb.plants_water',
  'considerations.green_thumb.tools_location',
  'considerations.green_thumb.outdoor_tap',
  'considerations.green_thumb.pets_on_site',
  'considerations.green_thumb.allergies',
  'considerations.green_thumb.contingency',
  'considerations.green_thumb.photo_updates',
  'considerations.green_thumb.mower_type',
  'considerations.green_thumb.garden_size',
  'considerations.green_thumb.green_waste',
];

const BOXES_CONSIDERATIONS: readonly string[] = [
  'considerations.boxes.lifting_floor',
  'considerations.boxes.volume',
  'considerations.boxes.supplies',
  'considerations.boxes.fragile_items',
  'considerations.boxes.move_date',
  'considerations.boxes.duration',
  'considerations.boxes.working_alone',
  'considerations.boxes.breakage',
  'considerations.boxes.car_licence',
  'considerations.boxes.gloves_clothing',
];

const IKEA_CONSIDERATIONS: readonly string[] = [
  'considerations.ikea.items_models',
  'considerations.ikea.instructions_parts',
  'considerations.ikea.tools',
  'considerations.ikea.drilling',
  'considerations.ikea.two_person_items',
  'considerations.ikea.floor_protection',
  'considerations.ikea.packaging',
  'considerations.ikea.time_per_item',
  'considerations.ikea.ladder_ceiling',
];

const PARTY_CONSIDERATIONS: readonly string[] = [
  'considerations.party.date_end_time',
  'considerations.party.guest_count_ages',
  'considerations.party.childcare_check',
  'considerations.party.alcohol',
  'considerations.party.food_allergies',
  'considerations.party.dress_code',
  'considerations.party.student_fed',
  'considerations.party.other_helpers',
  'considerations.party.adult_present',
  'considerations.party.neighbours_noise',
  'considerations.party.arrival_time',
];

const IT_CONSIDERATIONS: readonly string[] = [
  'considerations.it.passwords',
  'considerations.it.personal_data',
  'considerations.it.backup_first',
  'considerations.it.device_details',
  'considerations.it.warranty',
  'considerations.it.account_ownership',
  'considerations.it.no_purchases',
  'considerations.it.remote_or_in_person',
  'considerations.it.concrete_outcome',
  'considerations.it.written_summary',
];

const ERRANDS_CONSIDERATIONS: readonly string[] = [
  'considerations.errands.money_mechanism',
  'considerations.errands.keep_receipt',
  'considerations.errands.out_of_stock',
  'considerations.errands.prescriptions_id',
  'considerations.errands.spending_ceiling',
  'considerations.errands.distance_transport',
  'considerations.errands.cold_chain',
  'considerations.errands.load_weight',
  'considerations.errands.nobody_home',
];

const PET_HOUSE_CONSIDERATIONS: readonly string[] = [
  'considerations.pet_house.animal_profile',
  'considerations.pet_house.feeding_routine',
  'considerations.pet_house.medication',
  'considerations.pet_house.lead_harness_walk',
  'considerations.pet_house.behaviour',
  'considerations.pet_house.vet_authorisation',
  'considerations.pet_house.access',
  'considerations.pet_house.emergency',
  'considerations.pet_house.neighbours',
  'considerations.pet_house.insurance',
];

/**
 * The full V1 sub-category table (§5.1–§5.7). Keys are prefixed with their
 * category, and every category ends with a '<cat>_other' catch-all.
 *
 * Flags follow §5's per-category "Flags:" lines. Notably (§5.7): dog
 * walking and vet trips carry `guardianConsent` — AND SO DO drop-in checks
 * and feeding-while-away: those two put a student alone in a stranger's
 * empty home with keys, door codes and the alarm — the overnight
 * sub-category decision 13 cut, minus the sleeping. With no per-sub-category
 * age gate (decision 7), leaving them unflagged would mean no gate at all
 * for that scenario.
 */
export const SUB_CATEGORIES: readonly SubCategoryDef[] = [
  // ── 5.1 Green-Thumb ──
  {
    key: 'green_thumb_vacation_plant_care',
    category: 'green_thumb',
    considerationKeys: GREEN_THUMB_CONSIDERATIONS,
    // "a plant is a low-stakes one, but the same 'someone is depending on
    // this' prompt applies" (§5.1)
    flags: { livingCreature: true },
  },
  {
    key: 'green_thumb_garden_watering',
    category: 'green_thumb',
    considerationKeys: GREEN_THUMB_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'green_thumb_lawn_mowing',
    category: 'green_thumb',
    considerationKeys: GREEN_THUMB_CONSIDERATIONS,
    flags: { guardianConsent: true },
  },
  {
    key: 'green_thumb_planting_potting',
    category: 'green_thumb',
    considerationKeys: GREEN_THUMB_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'green_thumb_weeding_pruning',
    category: 'green_thumb',
    considerationKeys: GREEN_THUMB_CONSIDERATIONS,
    flags: { guardianConsent: true },
  },
  {
    key: 'green_thumb_green_waste',
    category: 'green_thumb',
    considerationKeys: GREEN_THUMB_CONSIDERATIONS,
    flags: { transport: true },
  },
  {
    key: 'green_thumb_other',
    category: 'green_thumb',
    considerationKeys: GREEN_THUMB_CONSIDERATIONS,
    flags: {},
  },

  // ── 5.2 Boxes ──
  {
    key: 'boxes_packing',
    category: 'boxes',
    considerationKeys: BOXES_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'boxes_unpacking',
    category: 'boxes',
    considerationKeys: BOXES_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'boxes_van_loading',
    category: 'boxes',
    considerationKeys: BOXES_CONSIDERATIONS,
    flags: { guardianConsent: true, recommendAdultPresent: true },
  },
  {
    key: 'boxes_clear_out',
    category: 'boxes',
    considerationKeys: BOXES_CONSIDERATIONS,
    flags: { guardianConsent: true, recommendAdultPresent: true },
  },
  {
    key: 'boxes_furniture_moving',
    category: 'boxes',
    considerationKeys: BOXES_CONSIDERATIONS,
    flags: { guardianConsent: true, recommendAdultPresent: true },
  },
  {
    key: 'boxes_dump_runs',
    category: 'boxes',
    considerationKeys: BOXES_CONSIDERATIONS,
    flags: { transport: true },
  },
  {
    key: 'boxes_other',
    category: 'boxes',
    considerationKeys: BOXES_CONSIDERATIONS,
    flags: {},
  },

  // ── 5.3 Ikea ──
  {
    key: 'ikea_assembly',
    category: 'ikea',
    considerationKeys: IKEA_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'ikea_disassembly',
    category: 'ikea',
    considerationKeys: IKEA_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'ikea_wall_mounting',
    category: 'ikea',
    considerationKeys: IKEA_CONSIDERATIONS,
    flags: { guardianConsent: true, recommendAdultPresent: true },
  },
  {
    key: 'ikea_store_pickup',
    category: 'ikea',
    considerationKeys: IKEA_CONSIDERATIONS,
    flags: { transport: true },
  },
  {
    key: 'ikea_fixing',
    category: 'ikea',
    considerationKeys: IKEA_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'ikea_other',
    category: 'ikea',
    considerationKeys: IKEA_CONSIDERATIONS,
    flags: {},
  },

  // ── 5.4 Party ──
  {
    key: 'party_setup',
    category: 'party',
    considerationKeys: PARTY_CONSIDERATIONS,
    flags: {},
  },
  {
    // The posting form additionally shows an explicit "is this childcare?"
    // → link-to-sync-sit interstitial for this sub-category (§5.4).
    key: 'party_kids_entertainment',
    category: 'party',
    considerationKeys: PARTY_CONSIDERATIONS,
    flags: { guardianConsent: true, recommendAdultPresent: true },
  },
  {
    key: 'party_serving',
    category: 'party',
    considerationKeys: PARTY_CONSIDERATIONS,
    flags: { recommendAdultPresent: true },
  },
  {
    key: 'party_music_tech',
    category: 'party',
    considerationKeys: PARTY_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'party_cleanup',
    category: 'party',
    considerationKeys: PARTY_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'party_baking',
    category: 'party',
    considerationKeys: PARTY_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'party_other',
    category: 'party',
    considerationKeys: PARTY_CONSIDERATIONS,
    flags: {},
  },

  // ── 5.5 IT — none require guardian consent (low physical risk); data
  // transfer and troubleshooting carry the strongest privacy copy. ──
  {
    key: 'it_device_setup',
    category: 'it',
    considerationKeys: IT_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'it_wifi_smart_home',
    category: 'it',
    considerationKeys: IT_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'it_data_transfer',
    category: 'it',
    considerationKeys: IT_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'it_troubleshooting',
    category: 'it',
    considerationKeys: IT_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'it_teaching',
    category: 'it',
    considerationKeys: IT_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'it_tv_audio',
    category: 'it',
    considerationKeys: IT_CONSIDERATIONS,
    flags: {},
  },
  {
    key: 'it_other',
    category: 'it',
    considerationKeys: IT_CONSIDERATIONS,
    flags: {},
  },

  // ── 5.6 Errands — every sub-category handles the family's money.
  // `handlesFamilyMoney` surfaces the standing platform line on the task and
  // the offer: sync-do handles no money and mediates no reimbursement
  // disputes — agree the mechanism in writing before starting. ──
  {
    key: 'errands_grocery',
    category: 'errands',
    considerationKeys: ERRANDS_CONSIDERATIONS,
    flags: { handlesFamilyMoney: true },
  },
  {
    key: 'errands_pharmacy',
    category: 'errands',
    considerationKeys: ERRANDS_CONSIDERATIONS,
    flags: { handlesFamilyMoney: true, guardianConsent: true },
  },
  {
    key: 'errands_parcels',
    category: 'errands',
    considerationKeys: ERRANDS_CONSIDERATIONS,
    flags: { handlesFamilyMoney: true },
  },
  {
    key: 'errands_dry_cleaning',
    category: 'errands',
    considerationKeys: ERRANDS_CONSIDERATIONS,
    flags: { handlesFamilyMoney: true },
  },
  {
    key: 'errands_returns',
    category: 'errands',
    considerationKeys: ERRANDS_CONSIDERATIONS,
    flags: { handlesFamilyMoney: true },
  },
  {
    key: 'errands_other',
    category: 'errands',
    considerationKeys: ERRANDS_CONSIDERATIONS,
    flags: { handlesFamilyMoney: true },
  },

  // ── 5.7 Pet & house-sitting — every sub-category has a living creature
  // (or an empty home) depending on it; overnight presence was CUT
  // (decision 13). Drop-in checks and feeding-while-away are guardian-
  // flagged alongside dog walking and vet trips — see the §5.7 rationale in
  // the table doc-comment above. ──
  {
    key: 'pet_house_dog_walking',
    category: 'pet_house',
    considerationKeys: PET_HOUSE_CONSIDERATIONS,
    flags: { livingCreature: true, guardianConsent: true },
  },
  {
    key: 'pet_house_feeding',
    category: 'pet_house',
    considerationKeys: PET_HOUSE_CONSIDERATIONS,
    flags: { livingCreature: true, guardianConsent: true },
  },
  {
    key: 'pet_house_drop_in',
    category: 'pet_house',
    considerationKeys: PET_HOUSE_CONSIDERATIONS,
    flags: { livingCreature: true, guardianConsent: true },
  },
  {
    key: 'pet_house_vet_trips',
    category: 'pet_house',
    considerationKeys: PET_HOUSE_CONSIDERATIONS,
    flags: { livingCreature: true, guardianConsent: true },
  },
  {
    key: 'pet_house_other',
    category: 'pet_house',
    considerationKeys: PET_HOUSE_CONSIDERATIONS,
    flags: { livingCreature: true },
  },
] as const;
