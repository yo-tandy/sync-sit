/**
 * `doSubmitOffer` / `doUpdateOffer` refusal → copy-key mapping (§13 PR8),
 * in one place so tests can pin it.
 *
 * Kept beside `OfferPage` rather than inside it so the page file exports
 * only its component — mixing a component export with plain constants
 * defeats Fast Refresh (react-refresh/only-export-components).
 */
export type Refusal =
  | 'task_offer_cap'
  | 'offer_cap'
  | 'under_15'
  | 'offer_exists'
  | 'task_not_open'
  | 'not_pending';

export const REFUSAL_KEYS: Record<Refusal, string> = {
  task_offer_cap: 'doer.offerForm.errorTaskOfferCap', // oversubscribed (§6.4's write-set bound)
  offer_cap: 'doer.offerForm.errorOfferCap',
  under_15: 'doer.offerForm.errorUnder15',
  offer_exists: 'doer.offerForm.errorOfferExists', // the resurrection matrix's already-exists arm
  task_not_open: 'doer.offerForm.errorTaskNotOpen',
  not_pending: 'doer.offerForm.errorNotPending',
};
