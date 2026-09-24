// Merging a list held in the cloud with the copy cached on this device.
// Kept free of Firebase imports so it can be tested on its own.

/** Merge a remote and a local list by id (remote wins), dropping anything deleted on either side. */
export function mergeLists(remoteList, localList, tombstones = []) {
  const dead = new Set((tombstones || []).map(String));
  const byId = new Map();
  for (const item of localList || []) if (item?.id != null && !dead.has(String(item.id))) byId.set(String(item.id), item);
  for (const item of remoteList || []) if (item?.id != null && !dead.has(String(item.id))) byId.set(String(item.id), item);
  return [...byId.values()];
}
