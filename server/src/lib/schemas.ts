import { z } from 'zod'

import { AssetType } from '../services/token-factory.js'

export const kleverAddress = z
  .string()
  .regex(/^klv1[0-9a-z]{38,}$/, 'invalid klv1 address')

export const tokenId = z
  .string()
  .regex(/^[A-Z0-9]{2,20}-[A-Z0-9]{4,8}$/, 'invalid token id (expected TICKER-XXXX)')

/**
 * Amounts travel only as strings in minimum units. JSON numbers above
 * Number.MAX_SAFE_INTEGER already arrive rounded by JSON.parse, so they are rejected.
 */
export const amount = z
  .string({ error: 'amount must be a decimal string in minimum units' })
  .regex(/^\d+$/, 'amount must be an integer in minimum units')
  .transform((v) => BigInt(v))

export const nonce = z.coerce.number().int().nonnegative().default(0)

/** Wait (or not) for on-chain confirmation; the default comes from .env. */
export const waitFlag = z.boolean().optional()

export const assetTypeInput = z
  .union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.enum(['Fungible', 'NFT', 'SemiFungible']),
    z.enum(['fungible', 'nft', 'semifungible', 'sft']),
  ])
  .transform((value) => {
    if (typeof value === 'number') return value as 0 | 1 | 2
    const normalized = value.toLowerCase()
    if (normalized === 'nft') return AssetType.NFT
    if (normalized === 'sft' || normalized === 'semifungible') return AssetType.SemiFungible
    return AssetType.Fungible
  })

export const issueBody = z
  .object({
    assetType: assetTypeInput.default(0),
    name: z.string().min(1, 'name is required').max(32, 'name must be at most 32 bytes'),
    ticker: z.string().min(1, 'ticker is required').max(10, 'ticker must be at most 10 bytes'),
    precision: z.coerce.number().int().min(0).max(18).default(6),
    initialSupply: amount.default(0n),
    maxSupply: amount.default(0n),
    wait: waitFlag,
  })
  .refine(
    (v) => v.maxSupply === 0n || v.maxSupply >= v.initialSupply,
    { message: 'maxSupply must be 0 (unlimited) or >= initialSupply', path: ['maxSupply'] },
  )
  .refine((v) => new TextEncoder().encode(v.name).length <= 32, {
    message: 'name exceeds 32 bytes in UTF-8',
    path: ['name'],
  })
  .refine((v) => new TextEncoder().encode(v.ticker).length <= 10, {
    message: 'ticker exceeds 10 bytes in UTF-8',
    path: ['ticker'],
  })

export const mintBody = z.object({
  nonce,
  amount: amount.refine((v) => v > 0n, 'amount must be greater than zero'),
  wait: waitFlag,
})

export const burnBody = z.object({
  tokenId,
  nonce,
  amount: amount.refine((v) => v > 0n, 'amount must be greater than zero'),
  wait: waitFlag,
})

export const transferOwnershipBody = z.object({
  newOwner: kleverAddress,
  wait: waitFlag,
})

export const contractNameBody = z.object({
  name: z.string().min(1).max(64),
  wait: waitFlag,
})

export const paginationQuery = z.object({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(100).default(20),
})
