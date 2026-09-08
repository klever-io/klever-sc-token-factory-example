import { createTransactionHash } from '@klever/connect'
import type { Contract } from '@klever/connect'
// Tipos de transação vivem no pacote de provider; o índice unificado não os reexporta.
import type {
  ILogEvent,
  IReceipt,
  ITransactionResponse,
  TransactionSubmitResult,
} from '@klever/connect-provider'

import { getKlever, requireContract } from '../klever.js'
import { HttpError, notFound, unavailable } from '../lib/errors.js'
import { decodeLogPayload, looksLikeTokenId } from '../lib/decode.js'

/**
 * Camada tipada sobre o `Contract` do klever-connect.
 *
 * O klever-connect gera métodos dinâmicos a partir do ABI (`contract.issue(...)`),
 * mas para o TypeScript eles são `unknown`. Aqui usamos `call()` (views) e
 * `invoke()` (transações), que são tipados, e devolvemos tipos concretos.
 */

/** 0=Fungible, 1=NFT, 2=SemiFungible — igual ao enum AssetType do contrato. */
export const AssetType = {
  Fungible: 0,
  NFT: 1,
  SemiFungible: 2,
} as const

export type AssetTypeName = keyof typeof AssetType
export type AssetTypeValue = (typeof AssetType)[AssetTypeName]

export const assetTypeName = (value: number): AssetTypeName | 'Unknown' =>
  (Object.keys(AssetType) as AssetTypeName[]).find((k) => AssetType[k] === value) ?? 'Unknown'

export interface TxResult {
  hash: string
  status: string
  explorerUrl: string
  /** Só quando a chamada esperou a confirmação on-chain. */
  transaction?: ITransactionResponse
  /** Preenchido pelo `issue`: id do KDA recém-criado (ex.: `MYTK-4A2B`). */
  tokenId?: string
}

export interface IssueParams {
  assetType: AssetTypeValue
  name: string
  ticker: string
  precision: number
  /** Em unidades mínimas (já multiplicado pela precisão). */
  initialSupply: bigint
  /** Em unidades mínimas. 0 = ilimitado. */
  maxSupply: bigint
}

function contract(): Contract {
  return requireContract().contract
}

function requireSigner(): Contract {
  const { wallet } = getKlever()
  if (!wallet) {
    throw unavailable(
      'Servidor em modo somente-leitura: configure WALLET_PEM_PATH para enviar transações',
    )
  }
  return contract()
}

/** `bytes` no ABI precisa chegar como Uint8Array; strings viram UTF-8. */
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value)

/** Normaliza o retorno de um `variadic<T>`: 0 itens → [], 1 item → valor solto. */
function toArray<T>(value: unknown): T[] {
  if (value === undefined || value === null || value === '') return []
  return (Array.isArray(value) ? value : [value]) as T[]
}

// =============================================================================
// Views (queryContract — sem taxa, sem transação)
// =============================================================================

export async function isPaused(): Promise<boolean> {
  // `bool` false vem como bytes vazios do nó; o decoder pode entregar '' ou '00'.
  const raw = await contract().call<unknown>('isPaused')
  return raw === true || raw === 1 || raw === '1' || raw === '01' || raw === 'true'
}

export async function getTotalIssued(): Promise<bigint> {
  return BigInt(await contract().call<bigint | number | string>('getTotalIssued'))
}

export async function getTokensByCreator(
  creator: string,
  offset: number,
  limit: number,
): Promise<string[]> {
  return toArray<string>(await contract().call('getTokensByCreator', creator, offset, limit))
}

export async function getCreatorTokenCount(creator: string): Promise<number> {
  return Number(await contract().call<bigint | number | string>('getCreatorTokenCount', creator))
}

/**
 * Criador registrado de um token, ou null.
 *
 * O storage vazio não é um erro no contrato: a view devolve bytes vazios, que o
 * decoder do klever-connect entrega como string vazia.
 */
export async function getTokenCreator(tokenId: string): Promise<string | null> {
  let creator: unknown
  try {
    creator = await contract().call<unknown>('getTokenCreator', tokenId)
  } catch (err) {
    // Storage vazio de um `SingleValueMapper<ManagedAddress>`: alguns nós
    // devolvem bytes vazios, outros falham ao decodificar 0 bytes como endereço.
    const message = err instanceof Error ? err.message : String(err)
    if (/storage decode error|bad array length/i.test(message)) return null
    throw err
  }
  return typeof creator === 'string' && creator.startsWith('klv1') ? creator : null
}

// =============================================================================
// Transações (invoke — assinadas pela carteira do servidor)
// =============================================================================

/**
 * Emite um novo token KDA. O contrato fica dono on-chain do ativo, e o supply
 * inicial (só Fungible) vai para quem chamou — aqui, a carteira do backend.
 */
export async function issue(params: IssueParams, wait: boolean): Promise<TxResult> {
  const result = await requireSigner().invoke(
    'issue',
    params.assetType,
    utf8(params.name),
    utf8(params.ticker),
    params.precision,
    params.initialSupply,
    params.maxSupply,
  )

  const tx = await settle(result, wait)
  const tokenId = tx.transaction ? extractIssuedTokenId(tx.transaction) : undefined
  return tokenId ? { ...tx, tokenId } : tx
}

/** Minta supply adicional. Só o criador registrado no contrato consegue. */
export async function mintToken(
  tokenId: string,
  nonce: number,
  amount: bigint,
  wait: boolean,
): Promise<TxResult> {
  return settle(await requireSigner().invoke('mintToken', tokenId, nonce, amount), wait)
}

/**
 * Queima tokens. `burnToken` é `#[payable("*")]` e não recebe argumentos: o valor
 * viaja como callValue da chamada, e o contrato lê o pagamento que recebeu.
 */
export async function burnToken(
  tokenId: string,
  nonce: number,
  amount: bigint,
  wait: boolean,
): Promise<TxResult> {
  // KDAs com nonce (NFT/SFT) são identificados como `TICKER-XXXX/nonce`.
  const assetId = nonce > 0 ? `${tokenId}/${nonce}` : tokenId
  return settle(await requireSigner().invoke('burnToken', { value: { [assetId]: amount } }), wait)
}

/** Transfere a propriedade on-chain do ativo. Irreversível: o contrato perde o controle. */
export async function transferTokenOwnership(
  tokenId: string,
  newOwner: string,
  wait: boolean,
): Promise<TxResult> {
  return settle(await requireSigner().invoke('transferTokenOwnership', tokenId, newOwner), wait)
}

// =============================================================================
// Admin (only_owner — a carteira do backend precisa ser a dona do contrato)
// =============================================================================

export async function pause(wait: boolean): Promise<TxResult> {
  return settle(await requireSigner().invoke('pause'), wait)
}

export async function unpause(wait: boolean): Promise<TxResult> {
  return settle(await requireSigner().invoke('unpause'), wait)
}

export async function changeContractName(name: string, wait: boolean): Promise<TxResult> {
  return settle(await requireSigner().invoke('changeContractName', utf8(name)), wait)
}

// =============================================================================
// Eventos
// =============================================================================

export interface DecodedEvent {
  identifier: string
  address: string
  topics: string[]
  /** Topics decodificados como texto quando são legíveis (token id, nome, ticker). */
  decodedTopics: string[]
  data: string[]
}

/**
 * Extrai os eventos emitidos pelo TokenFactory nos logs de uma transação.
 *
 * `parseEvents` (do klever-connect) filtra os logs pelo endereço do contrato; a
 * decodificação dos topics fica por nossa conta porque o TokenFactory indexa
 * tipos mistos (endereço, token id, u8, bytes, BigUint).
 */
export function decodeEvents(receipt: ITransactionResponse): DecodedEvent[] {
  const { contract: c, contractAddress } = requireContract()

  return c.parseEvents(receipt.logs, { address: contractAddress }).map((event) => ({
    identifier: event.identifier,
    address: event.address,
    topics: event.topics,
    decodedTopics: event.topics.map((t) => decodeLogPayload(t) ?? t),
    data: event.data,
  }))
}

/** Busca a transação na rede e devolve seus eventos de contrato. */
export async function getContractEvents(hash: string): Promise<DecodedEvent[]> {
  const { provider } = getKlever()
  const tx = await provider.getTransaction(createTransactionHash(hash))
  if (!tx) throw notFound(`Transação ${hash} não encontrada`)
  return decodeEvents(tx)
}

// =============================================================================
// Resposta compacta de transação
// =============================================================================

export interface TxSummary {
  hash: string
  status: string
  explorerUrl: string
  tokenId?: string
  block?: number
  feeKLV?: number
  events?: DecodedEvent[]
}

/**
 * Versão enxuta do resultado para a resposta HTTP: o recibo bruto da rede é
 * grande e a maior parte não interessa a quem chamou a API.
 */
export function summarize(tx: TxResult): TxSummary {
  const summary: TxSummary = {
    hash: tx.hash,
    status: tx.status,
    explorerUrl: tx.explorerUrl,
  }

  if (tx.tokenId) summary.tokenId = tx.tokenId
  if (!tx.transaction) return summary

  summary.block = tx.transaction.blockNum
  summary.feeKLV = tx.transaction.totalFee
  summary.events = decodeEvents(tx.transaction)
  return summary
}

// =============================================================================
// Helpers de transação
// =============================================================================

/** Aguarda a confirmação quando `wait` é true; devolve hash + status em qualquer caso. */
async function settle(result: TransactionSubmitResult, wait: boolean): Promise<TxResult> {
  const hash = String(result.hash)
  const explorerUrl = getKlever().provider.getTransactionUrl(hash)

  if (!wait || !result.wait) {
    return { hash, status: result.status, explorerUrl }
  }

  const receipt = await result.wait()

  // O nó aceita o broadcast antes de executar o contrato: um `require!` que
  // falhou só aparece aqui, no status/logs da transação minerada.
  const failure = contractFailureMessage(receipt)
  if (failure) throw new HttpError(400, failure, { hash, explorerUrl })

  return { hash, status: String(receipt.status), explorerUrl, transaction: receipt }
}

/** Devolve a mensagem de reverte do contrato, ou null se a transação passou. */
function contractFailureMessage(receipt: ITransactionResponse): string | null {
  const signalError = receipt.logs?.events?.find((e: ILogEvent) => e.identifier === 'signalError')

  if (signalError) {
    const payload = [...(signalError.data ?? []), ...(signalError.topics ?? [])]
      .map(decodeLogPayload)
      .find((text): text is string => Boolean(text))
    return payload ?? 'Transação revertida pelo contrato'
  }

  const status = String(receipt.status)
  if (status === 'fail' || status === 'failed' || status === 'invalid') {
    return `Transação falhou (status: ${status}, resultCode: ${receipt.resultCode ?? 'n/d'})`
  }

  return null
}

/**
 * Extrai o id do KDA criado por `issue`.
 *
 * Fontes, nessa ordem: o returnData do recibo de smart contract (tipo 21), o
 * evento `tokenIssued` e o evento `ReturnData` da VM. Nos logs da Klever o
 * `identifier` de um evento de contrato é o endpoint chamado (`issue`) e o nome
 * do evento (`tokenIssued`) vai no primeiro topic.
 */
export function extractIssuedTokenId(receipt: ITransactionResponse): string | undefined {
  const scReceipt = receipt.receipts?.find(
    (r: IReceipt) => r.type === 21 || r.typeString === 'SmartContract',
  ) as { returnData?: string | string[] } | undefined

  const returnData = scReceipt?.returnData
  const candidates = Array.isArray(returnData) ? returnData : returnData ? [returnData] : []

  const events = receipt.logs?.events ?? []
  const issued = events.find(
    (e: ILogEvent) =>
      e.identifier === 'tokenIssued' || decodeLogPayload(e.topics?.[0]) === 'tokenIssued',
  )
  candidates.push(...(issued?.topics ?? []))

  const returned = events.find((e: ILogEvent) => e.identifier === 'ReturnData')
  candidates.push(...(returned?.data ?? []))

  for (const candidate of candidates) {
    const decoded = decodeLogPayload(candidate)
    if (decoded && looksLikeTokenId(decoded)) return decoded
  }

  return undefined
}
