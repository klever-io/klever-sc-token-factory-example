import { createTransactionHash } from '@klever/connect'
import type { Contract } from '@klever/connect'
// Transaction types live in the provider package; the unified index does not re-export them.
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
 * Typed layer over klever-connect's `Contract`.
 *
 * klever-connect generates dynamic methods from the ABI (`contract.issue(...)`),
 * but to TypeScript they are `unknown`. Here we use `call()` (views) and
 * `invoke()` (transactions), which are typed, and return concrete types.
 */

/** 0=Fungible, 1=NFT, 2=SemiFungible — same as the contract's AssetType enum. */
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
  /** Only when the call waited for on-chain confirmation. */
  transaction?: ITransactionResponse
  /** Filled in by `issue`: id of the newly created KDA (e.g. `MYTK-4A2B`). */
  tokenId?: string
}

export interface IssueParams {
  assetType: AssetTypeValue
  name: string
  ticker: string
  precision: number
  /** In minimum units (already multiplied by the precision). */
  initialSupply: bigint
  /** In minimum units. 0 = unlimited. */
  maxSupply: bigint
}

function contract(): Contract {
  return requireContract().contract
}

function requireSigner(): Contract {
  const { wallet } = getKlever()
  if (!wallet) {
    throw unavailable(
      'Server in read-only mode: set WALLET_PEM_PATH to send transactions',
    )
  }
  return contract()
}

/** `bytes` in the ABI must arrive as Uint8Array; strings become UTF-8. */
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value)

/** Normalizes the return of a `variadic<T>`: 0 items → [], 1 item → bare value. */
function toArray<T>(value: unknown): T[] {
  if (value === undefined || value === null || value === '') return []
  return (Array.isArray(value) ? value : [value]) as T[]
}

// =============================================================================
// Views (queryContract — no fee, no transaction)
// =============================================================================

export async function isPaused(): Promise<boolean> {
  // `bool` false comes back from the node as empty bytes; the decoder may yield '' or '00'.
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
 * Creator registered for a token, or null.
 *
 * Empty storage is not an error in the contract: the view returns empty bytes, which the
 * klever-connect decoder delivers as an empty string.
 */
export async function getTokenCreator(tokenId: string): Promise<string | null> {
  let creator: unknown
  try {
    creator = await contract().call<unknown>('getTokenCreator', tokenId)
  } catch (err) {
    // Empty storage of a `SingleValueMapper<ManagedAddress>`: some nodes
    // return empty bytes, others fail to decode 0 bytes as an address.
    const message = err instanceof Error ? err.message : String(err)
    if (/storage decode error|bad array length/i.test(message)) return null
    throw err
  }
  return typeof creator === 'string' && creator.startsWith('klv1') ? creator : null
}

// =============================================================================
// Transactions (invoke — signed by the server wallet)
// =============================================================================

/**
 * Issues a new KDA token. The contract becomes the on-chain owner of the asset, and the
 * initial supply (Fungible only) goes to the caller — here, the backend wallet.
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

/** Mints additional supply. Only the creator registered in the contract can. */
export async function mintToken(
  tokenId: string,
  nonce: number,
  amount: bigint,
  wait: boolean,
): Promise<TxResult> {
  return settle(await requireSigner().invoke('mintToken', tokenId, nonce, amount), wait)
}

/**
 * Burns tokens. `burnToken` is `#[payable("*")]` and takes no arguments: the amount
 * travels as the call's callValue, and the contract reads the payment it received.
 */
export async function burnToken(
  tokenId: string,
  nonce: number,
  amount: bigint,
  wait: boolean,
): Promise<TxResult> {
  // KDAs with a nonce (NFT/SFT) are identified as `TICKER-XXXX/nonce`.
  const assetId = nonce > 0 ? `${tokenId}/${nonce}` : tokenId
  return settle(await requireSigner().invoke('burnToken', { value: { [assetId]: amount } }), wait)
}

/** Transfers the on-chain ownership of the asset. Irreversible: the contract loses control. */
export async function transferTokenOwnership(
  tokenId: string,
  newOwner: string,
  wait: boolean,
): Promise<TxResult> {
  return settle(await requireSigner().invoke('transferTokenOwnership', tokenId, newOwner), wait)
}

// =============================================================================
// Admin (only_owner — the backend wallet must be the contract owner)
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
// Events
// =============================================================================

export interface DecodedEvent {
  identifier: string
  address: string
  topics: string[]
  /** Topics decoded as text when readable (token id, name, ticker). */
  decodedTopics: string[]
  data: string[]
}

/**
 * Extracts the events emitted by the TokenFactory from a transaction's logs.
 *
 * `parseEvents` (from klever-connect) filters the logs by contract address;
 * decoding the topics is left to us because the TokenFactory indexes
 * mixed types (address, token id, u8, bytes, BigUint).
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

/** Fetches the transaction from the network and returns its contract events. */
export async function getContractEvents(hash: string): Promise<DecodedEvent[]> {
  const { provider } = getKlever()
  const tx = await provider.getTransaction(createTransactionHash(hash))
  if (!tx) throw notFound(`Transaction ${hash} not found`)
  return decodeEvents(tx)
}

// =============================================================================
// Compact transaction response
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
 * Slimmed-down version of the result for the HTTP response: the raw network receipt is
 * large and most of it is irrelevant to the API caller.
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
// Transaction helpers
// =============================================================================

/** Waits for confirmation when `wait` is true; returns hash + status in any case. */
async function settle(result: TransactionSubmitResult, wait: boolean): Promise<TxResult> {
  const hash = String(result.hash)
  const explorerUrl = getKlever().provider.getTransactionUrl(hash)

  if (!wait || !result.wait) {
    return { hash, status: result.status, explorerUrl }
  }

  const receipt = await result.wait()

  // The node accepts the broadcast before executing the contract: a `require!` that
  // failed only shows up here, in the mined transaction's status/logs.
  const failure = contractFailureMessage(receipt)
  if (failure) throw new HttpError(400, failure, { hash, explorerUrl })

  return { hash, status: String(receipt.status), explorerUrl, transaction: receipt }
}

/** Returns the contract's revert message, or null if the transaction passed. */
function contractFailureMessage(receipt: ITransactionResponse): string | null {
  const signalError = receipt.logs?.events?.find((e: ILogEvent) => e.identifier === 'signalError')

  if (signalError) {
    const payload = [...(signalError.data ?? []), ...(signalError.topics ?? [])]
      .map(decodeLogPayload)
      .find((text): text is string => Boolean(text))
    return payload ?? 'Transaction reverted by the contract'
  }

  const status = String(receipt.status)
  if (status === 'fail' || status === 'failed' || status === 'invalid') {
    return `Transaction failed (status: ${status}, resultCode: ${receipt.resultCode ?? 'n/a'})`
  }

  return null
}

/**
 * Extracts the id of the KDA created by `issue`.
 *
 * Sources, in this order: the returnData of the smart contract receipt (type 21), the
 * `tokenIssued` event and the VM's `ReturnData` event. In Klever logs the
 * `identifier` of a contract event is the called endpoint (`issue`) and the name
 * of the event (`tokenIssued`) goes in the first topic.
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
