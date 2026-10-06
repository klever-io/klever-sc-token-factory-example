import { getKlever } from '../klever.js'

/**
 * On-chain data of a KDA, coming from the API/indexer of the configured network.
 *
 * The contract only stores the creator; name, precision, supply and properties
 * live on the asset itself, and the Klever indexer exposes them at `/v1.0/assets/:id`.
 */
export interface AssetInfo {
  assetId: string
  name: string
  ticker: string
  assetType: string
  ownerAddress: string
  precision: number
  initialSupply: string
  circulatingSupply: string
  maxSupply: string
  mintedValue: string
  burnedValue: string
  issueDate: number
  logo: string
  properties: Record<string, boolean>
}

interface ApiAssetPayload {
  data?: { asset?: Record<string, unknown> }
  error?: string
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v))

/** Returns null when the indexer does not know the asset. */
export async function getAssetInfo(assetId: string): Promise<AssetInfo | null> {
  const { network } = getKlever()
  const url = `${network.config.api}/v1.0/assets/${encodeURIComponent(assetId)}`

  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Indexer responded ${res.status} for ${url}`)

  const payload = (await res.json()) as ApiAssetPayload
  const a = payload.data?.asset
  if (!a) return null

  return {
    assetId: str(a.assetId),
    name: str(a.name),
    ticker: str(a.ticker),
    assetType: str(a.assetType),
    ownerAddress: str(a.ownerAddress),
    precision: Number(a.precision ?? 0),
    initialSupply: str(a.initialSupply ?? 0),
    circulatingSupply: str(a.circulatingSupply ?? 0),
    maxSupply: str(a.maxSupply ?? 0),
    mintedValue: str(a.mintedValue ?? 0),
    burnedValue: str(a.burnedValue ?? 0),
    issueDate: Number(a.issueDate ?? 0),
    logo: str(a.logo),
    properties: (a.properties as Record<string, boolean> | undefined) ?? {},
  }
}
