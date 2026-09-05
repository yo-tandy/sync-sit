/**
 * Canonical address shape (issue #435 milestone, PR1: root identity fields).
 *
 * This mirrors the shape the shared `AddressAutocomplete` component
 * (`packages/shared-ui`) has produced since the parent-enrollment flow first
 * collected addresses (`geometry.coordinates` from the api-adresse.data.gouv.fr
 * response, split into `fullAddress`/`street`/`city`/`postcode`/`lat`/`lng`).
 * `AddressAutocomplete` re-exports this as `AddressResult` for backward
 * compatibility with its existing call sites (sit's `ParentFormData`, study's
 * `FamilyFormData`, `AreaPage`, `FamilySettingsPage`, `SearchPage`, etc.) —
 * `shared-ui` depends on `shared-core`, never the reverse, so the canonical
 * definition lives here and `shared-ui` aliases to it.
 */
export interface Address {
  fullAddress: string;
  street: string;
  city: string;
  postcode: string;
  lat: number;
  lng: number;
}
