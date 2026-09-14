import { getKlever } from '../klever.js'

/**
 * Dados on-chain de um KDA, vindos da API/indexer da rede configurada.
 *
 * O contrato só guarda o criador; nome, precisão, supply e propriedades
 * vivem no próprio ativo, e o indexer da Klever expõe isso em `/v1.0/assets/:id`.
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

/** Devolve null quando o indexer não conhece o ativo. */
export async function getAssetInfo(assetId: string): Promise<AssetInfo | null> {
  const { network } = getKlever()
  const url = `${network.config.api}/v1.0/assets/${encodeURIComponent(assetId)}`

  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Indexer respondeu ${res.status} para ${url}`)

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
