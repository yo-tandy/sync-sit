// Paris-time wall-clock helpers now live in @ejm/shared-functions so the
// study crons can share the DST-correct conversion (the #74 two-pass fix in
// parisWallTimeToUtc). Re-exported here so sit's existing import sites
// (./parisTime.js) stay untouched.
export * from '@ejm/shared-functions/scheduled/parisTime.js';
