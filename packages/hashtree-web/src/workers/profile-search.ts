/**
 * Profile Search Index
 *
 * Fuse.js-based search index for user profiles.
 * Used by worker to handle search queries.
 */
import Fuse from "fuse.js"

export type SearchResult = {
  name: string
  pubKey: string
  nip05?: string
}

let searchIndex: Fuse<SearchResult> = new Fuse<SearchResult>([], {
  keys: ["name", "nip05"],
  includeScore: true,
})

const indexedPubkeys = new Set<string>()
const latestProfileTimestamps = new Map<string, number>()

export function updateSearchIndex(
  pubkey: string,
  name: string,
  nip05?: string,
  created_at?: number
) {
  if (!name) return

  const lastSeen = latestProfileTimestamps.get(pubkey) || 0
  if (created_at && created_at <= lastSeen) return

  if (created_at) {
    latestProfileTimestamps.set(pubkey, created_at)
  }
  searchIndex.remove((profile) => profile.pubKey === pubkey)
  searchIndex.add({name: String(name), pubKey: pubkey, nip05})
  indexedPubkeys.add(pubkey)
}

export function initSearchIndex(profiles: SearchResult[]) {
  const validProfiles = profiles.filter((p) => p.name)
  searchIndex = new Fuse<SearchResult>(validProfiles, {
    keys: ["name", "nip05"],
    includeScore: true,
  })
  indexedPubkeys.clear()
  latestProfileTimestamps.clear()
  for (const profile of validProfiles) {
    indexedPubkeys.add(profile.pubKey)
  }
}

export function searchProfiles(
  query: string
): Array<{item: SearchResult; score?: number}> {
  const results = searchIndex.search(query)
  return results.map((r) => ({item: r.item, score: r.score}))
}
