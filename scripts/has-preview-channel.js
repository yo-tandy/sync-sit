/**
 * Predicate for the preview-channel cleanup workflow (issue #316): does the
 * `firebase hosting:channel:list --json` output on stdin contain the channel
 * named in argv[2]?
 *
 * Exit codes are the CONTRACT (the workflow branches on them):
 *   0 -- channel present
 *   1 -- channel absent (list is valid, channel just isn't there)
 *   2 -- list output is NOT a valid success payload (CLI error status,
 *        malformed/empty JSON) -- the caller must treat this as a FAILURE,
 *        not a skip: swallowing a broken list is exactly the silent-death
 *        mode that rebuilds the quota problem (PR #323 round 1).
 */
function classifyChannelList(raw, channelId) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 2;
  }
  if (!parsed || parsed.status !== 'success' || !parsed.result || !Array.isArray(parsed.result.channels)) {
    return 2;
  }
  const has = parsed.result.channels.some(
    (c) => typeof c?.name === 'string' && c.name.endsWith('/channels/' + channelId),
  );
  return has ? 0 : 1;
}

module.exports = { classifyChannelList };

if (require.main === module) {
  const channelId = process.argv[2];
  if (!channelId) {
    console.error('usage: has-preview-channel.js <channelId> < list.json');
    process.exit(2);
  }
  let data = '';
  process.stdin.on('data', (c) => (data += c));
  process.stdin.on('end', () => process.exit(classifyChannelList(data, channelId)));
}
