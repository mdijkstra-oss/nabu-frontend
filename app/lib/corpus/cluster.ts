import { createUnionFind, union, groups } from "~/lib/utils/union-find"
import { cosineSimilarity } from "~/lib/embeddings/similarity"
import { fetchEmbeddingBatch } from "~/lib/embeddings/client"

export interface LabelCluster {
  representative: string
  members: string[]
}

export interface LabelRemaps {
  types: Map<string, string>
  subjects: Map<string, string>
}

const pickRepresentative = (members: string[], counts: Map<string, number>): string =>
  [...members].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b))[0]

export const clusterLabels = (
  labels: string[],
  embeddings: number[][],
  threshold: number,
  counts: Map<string, number> = new Map()
): LabelCluster[] => {
  const n = labels.length
  if (n === 0) return []

  const uf = createUnionFind(n)

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (cosineSimilarity(embeddings[i], embeddings[j]) > threshold) {
        union(uf, i, j)
      }
    }
  }

  return groups(uf).map((indices) => {
    const members = indices.map((i) => labels[i])
    return { representative: pickRepresentative(members, counts), members }
  })
}

export const buildLabelRemap = (clusters: LabelCluster[]): Map<string, string> => {
  const remap = new Map<string, string>()
  for (const { representative, members } of clusters) {
    for (const member of members) {
      remap.set(member, representative)
    }
  }
  return remap
}

export const buildRemaps = (
  typeClusters: LabelCluster[],
  subjectClusters: LabelCluster[]
): LabelRemaps => ({
  types: buildLabelRemap(typeClusters),
  subjects: buildLabelRemap(subjectClusters),
})

export const groupNearbyLabels = async (
  labels: string[],
  baseUrl: string,
  threshold: number,
  counts: Map<string, number> = new Map()
): Promise<LabelCluster[]> => {
  if (labels.length === 0) return []
  if (labels.length === 1) return [{ representative: labels[0], members: [labels[0]] }]

  const result = await fetchEmbeddingBatch(labels, baseUrl)
  if (!result.ok) {
    console.warn(`[cluster] embedding failed: ${result.error.message}`)
    return labels.map((l) => ({ representative: l, members: [l] }))
  }

  const clusters = clusterLabels(labels, result.value, threshold, counts)

  return clusters
}
