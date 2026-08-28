import { describe, it, expect } from 'vitest';
import {
  SUB_CATEGORIES,
  TASK_CATEGORIES,
  type TaskCategory,
} from '../categories.js';
import { CONSIDERATIONS_EN, CONSIDERATIONS_FR } from '../../content/index.js';
import {
  getSubCategories,
  getSubCategoryDef,
  isTaskCategory,
  requiresGuardianConsent,
  validateCategoryPair,
} from '../../utils/taxonomy.js';

describe('taxonomy integrity (§5, §14)', () => {
  it('has exactly the seven V1 categories (decisions 5, 6)', () => {
    expect(TASK_CATEGORIES).toEqual([
      'green_thumb',
      'boxes',
      'ikea',
      'party',
      'it',
      'errands',
      'pet_house',
    ]);
  });

  it('every sub-category references a real category', () => {
    for (const def of SUB_CATEGORIES) {
      expect(TASK_CATEGORIES).toContain(def.category);
    }
  });

  it('every flagged sub-category (guardian-consent / adult-present / money / creature / transport) references a real category', () => {
    // Asserted per flag FAMILY so the title's promise holds for each of the
    // five independently — and each family is non-empty, so a refactor that
    // strips a whole flag off the taxonomy fails here instead of passing
    // vacuously.
    const families = [
      'guardianConsent',
      'recommendAdultPresent',
      'handlesFamilyMoney',
      'livingCreature',
      'transport',
    ] as const;
    for (const flag of families) {
      const flagged = SUB_CATEGORIES.filter((s) => s.flags[flag] === true);
      expect(flagged.length, `no sub-category carries ${flag}`).toBeGreaterThan(0);
      for (const def of flagged) {
        expect(isTaskCategory(def.category), `${def.key} (${flag})`).toBe(true);
        // ...and is reachable through the lookups the consent gate and the
        // posting wizard actually use.
        expect(getSubCategoryDef(def.key)).toBe(def);
        expect(getSubCategories(def.category)).toContain(def);
      }
    }
  });

  it('sub-category keys are unique', () => {
    const keys = SUB_CATEGORIES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every key is prefixed with its category', () => {
    for (const def of SUB_CATEGORIES) {
      expect(def.key.startsWith(`${def.category}_`)).toBe(true);
    }
  });

  it("every category has a '<cat>_other' catch-all (§4.1)", () => {
    for (const cat of TASK_CATEGORIES) {
      expect(SUB_CATEGORIES.some((s) => s.key === `${cat}_other`)).toBe(true);
    }
  });

  it('carries exactly the §5 sub-category keys per category', () => {
    // Deliberately a change-detector: PR1's contract IS the §5 key list, in
    // §5 order — these keys are what tasks persist in `subCategory`, what
    // the i18n label namespace hangs off, and what the guardian flags key
    // on. A legitimate taxonomy change updates this expectation in the same
    // commit, and the diff names exactly which key moved (which a bare
    // count never did).
    const expected: Record<TaskCategory, string[]> = {
      green_thumb: [
        'green_thumb_vacation_plant_care',
        'green_thumb_garden_watering',
        'green_thumb_lawn_mowing',
        'green_thumb_planting_potting',
        'green_thumb_weeding_pruning',
        'green_thumb_green_waste',
        'green_thumb_other',
      ],
      boxes: [
        'boxes_packing',
        'boxes_unpacking',
        'boxes_van_loading',
        'boxes_clear_out',
        'boxes_furniture_moving',
        'boxes_dump_runs',
        'boxes_other',
      ],
      ikea: [
        'ikea_assembly',
        'ikea_disassembly',
        'ikea_wall_mounting',
        'ikea_store_pickup',
        'ikea_fixing',
        'ikea_other',
      ],
      party: [
        'party_setup',
        'party_kids_entertainment',
        'party_serving',
        'party_music_tech',
        'party_cleanup',
        'party_baking',
        'party_other',
      ],
      it: [
        'it_device_setup',
        'it_wifi_smart_home',
        'it_data_transfer',
        'it_troubleshooting',
        'it_teaching',
        'it_tv_audio',
        'it_other',
      ],
      errands: [
        'errands_grocery',
        'errands_pharmacy',
        'errands_parcels',
        'errands_dry_cleaning',
        'errands_returns',
        'errands_other',
      ],
      pet_house: [
        'pet_house_dog_walking',
        'pet_house_feeding',
        'pet_house_drop_in',
        'pet_house_vet_trips',
        'pet_house_other',
      ],
    };
    for (const cat of TASK_CATEGORIES) {
      expect(getSubCategories(cat).map((s) => s.key)).toEqual(expected[cat]);
    }
  });

  it('overnight house-sitting is removed, not present (decision 13)', () => {
    expect(SUB_CATEGORIES.some((s) => s.key.includes('overnight'))).toBe(false);
  });
});

describe('considerations content (§5: EN + FR, every sub-category)', () => {
  it('every sub-category has a non-empty considerations list resolving in BOTH locales', () => {
    for (const def of SUB_CATEGORIES) {
      expect(def.considerationKeys.length).toBeGreaterThan(0);
      for (const key of def.considerationKeys) {
        expect(CONSIDERATIONS_EN[key], `EN missing ${key}`).toBeTypeOf('string');
        expect(CONSIDERATIONS_EN[key]!.length).toBeGreaterThan(0);
        expect(CONSIDERATIONS_FR[key], `FR missing ${key}`).toBeTypeOf('string');
        expect(CONSIDERATIONS_FR[key]!.length).toBeGreaterThan(0);
      }
    }
  });

  it('EN and FR carry identical key sets (no locale drifts)', () => {
    expect(Object.keys(CONSIDERATIONS_EN).sort()).toEqual(
      Object.keys(CONSIDERATIONS_FR).sort(),
    );
  });

  it('no orphaned content: every consideration key is referenced by some sub-category', () => {
    const referenced = new Set(
      SUB_CATEGORIES.flatMap((s) => s.considerationKeys),
    );
    for (const key of Object.keys(CONSIDERATIONS_EN)) {
      expect(referenced.has(key), `orphaned key ${key}`).toBe(true);
    }
  });

  it('consideration keys within a sub-category are unique', () => {
    for (const def of SUB_CATEGORIES) {
      expect(new Set(def.considerationKeys).size).toBe(
        def.considerationKeys.length,
      );
    }
  });
});

describe('the §5 flag assignments', () => {
  const flagsOf = (key: string) => {
    const def = getSubCategoryDef(key);
    expect(def, `unknown sub-category ${key}`).toBeDefined();
    return def!.flags;
  };

  it('green_thumb: mowing and pruning → guardianConsent; vacation care → livingCreature; green-waste → transport', () => {
    expect(flagsOf('green_thumb_lawn_mowing').guardianConsent).toBe(true);
    expect(flagsOf('green_thumb_weeding_pruning').guardianConsent).toBe(true);
    expect(flagsOf('green_thumb_vacation_plant_care').livingCreature).toBe(true);
    expect(flagsOf('green_thumb_green_waste').transport).toBe(true);
    expect(flagsOf('green_thumb_planting_potting').guardianConsent).toBeUndefined();
  });

  it('boxes: van loading, clear-outs, furniture moving → guardianConsent + recommendAdultPresent; dump runs → transport', () => {
    for (const key of ['boxes_van_loading', 'boxes_clear_out', 'boxes_furniture_moving']) {
      expect(flagsOf(key).guardianConsent).toBe(true);
      expect(flagsOf(key).recommendAdultPresent).toBe(true);
    }
    expect(flagsOf('boxes_dump_runs').transport).toBe(true);
    expect(flagsOf('boxes_packing').guardianConsent).toBeUndefined();
  });

  it('ikea: wall mounting → guardianConsent + recommendAdultPresent; store pick-up → transport', () => {
    expect(flagsOf('ikea_wall_mounting').guardianConsent).toBe(true);
    expect(flagsOf('ikea_wall_mounting').recommendAdultPresent).toBe(true);
    expect(flagsOf('ikea_store_pickup').transport).toBe(true);
    expect(flagsOf('ikea_assembly').guardianConsent).toBeUndefined();
  });

  it("party: kids' entertainment → guardianConsent + recommendAdultPresent; serving → recommendAdultPresent", () => {
    expect(flagsOf('party_kids_entertainment').guardianConsent).toBe(true);
    expect(flagsOf('party_kids_entertainment').recommendAdultPresent).toBe(true);
    expect(flagsOf('party_serving').recommendAdultPresent).toBe(true);
    expect(flagsOf('party_serving').guardianConsent).toBeUndefined();
  });

  it('it: no sub-category requires guardian consent (low physical risk)', () => {
    for (const def of getSubCategories('it')) {
      expect(def.flags.guardianConsent).toBeUndefined();
    }
  });

  it('errands: EVERY sub-category handles family money; pharmacy also guardianConsent', () => {
    for (const def of getSubCategories('errands')) {
      expect(def.flags.handlesFamilyMoney, def.key).toBe(true);
    }
    expect(flagsOf('errands_pharmacy').guardianConsent).toBe(true);
    expect(flagsOf('errands_grocery').guardianConsent).toBeUndefined();
  });

  it('pet_house: EVERY sub-category has a living creature; dog walking, vet trips AND drop-in checks + feeding are guardian-flagged (§5.7)', () => {
    for (const def of getSubCategories('pet_house')) {
      expect(def.flags.livingCreature, def.key).toBe(true);
    }
    for (const key of [
      'pet_house_dog_walking',
      'pet_house_vet_trips',
      'pet_house_drop_in',
      'pet_house_feeding',
    ]) {
      expect(flagsOf(key).guardianConsent, key).toBe(true);
    }
  });
});

describe('taxonomy helpers', () => {
  it('isTaskCategory guards the seven and nothing else', () => {
    expect(isTaskCategory('ikea')).toBe(true);
    expect(isTaskCategory('overnight')).toBe(false);
    expect(isTaskCategory('tasks')).toBe(false);
    expect(isTaskCategory(3)).toBe(false);
  });

  it('validateCategoryPair accepts matching pairs and rejects mismatches', () => {
    expect(validateCategoryPair('ikea', 'ikea_assembly')).toBeNull();
    expect(validateCategoryPair('party', 'party_other')).toBeNull();
    expect(validateCategoryPair('ikea', 'party_setup')).not.toBeNull();
    expect(validateCategoryPair('ikea', 'ikea_overnight')).not.toBeNull();
    expect(validateCategoryPair('sofa', 'ikea_assembly')).not.toBeNull();
    expect(validateCategoryPair('ikea', 42)).not.toBeNull();
  });

  it('requiresGuardianConsent fails CLOSED on unknown keys', () => {
    expect(requiresGuardianConsent('ikea_wall_mounting')).toBe(true);
    expect(requiresGuardianConsent('ikea_assembly')).toBe(false);
    expect(requiresGuardianConsent('not_a_key')).toBe(true);
  });
});
