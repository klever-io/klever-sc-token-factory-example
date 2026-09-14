import { z } from 'zod'

import { AssetType } from '../services/token-factory.js'

export const kleverAddress = z
  .string()
  .regex(/^klv1[0-9a-z]{38,}$/, 'endereço klv1 inválido')

export const tokenId = z
  .string()
  .regex(/^[A-Z0-9]{2,20}-[A-Z0-9]{4,8}$/, 'token id inválido (esperado TICKER-XXXX)')

/**
 * Quantidades trafegam só como string em unidades mínimas. Números JSON acima de
 * Number.MAX_SAFE_INTEGER já chegam arredondados pelo JSON.parse, então são recusados.
 */
export const amount = z
  .string({ error: 'quantidade deve ser uma string decimal em unidades mínimas' })
  .regex(/^\d+$/, 'quantidade deve ser um inteiro em unidades mínimas')
  .transform((v) => BigInt(v))

export const nonce = z.coerce.number().int().nonnegative().default(0)

/** Espera (ou não) a confirmação on-chain; o default vem do .env. */
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
    name: z.string().min(1, 'nome obrigatório').max(32, 'nome com no máximo 32 bytes'),
    ticker: z.string().min(1, 'ticker obrigatório').max(10, 'ticker com no máximo 10 bytes'),
    precision: z.coerce.number().int().min(0).max(18).default(6),
    initialSupply: amount.default(0n),
    maxSupply: amount.default(0n),
    wait: waitFlag,
  })
  .refine(
    (v) => v.maxSupply === 0n || v.maxSupply >= v.initialSupply,
    { message: 'maxSupply deve ser 0 (ilimitado) ou >= initialSupply', path: ['maxSupply'] },
  )
  .refine((v) => new TextEncoder().encode(v.name).length <= 32, {
    message: 'nome excede 32 bytes em UTF-8',
    path: ['name'],
  })
  .refine((v) => new TextEncoder().encode(v.ticker).length <= 10, {
    message: 'ticker excede 10 bytes em UTF-8',
    path: ['ticker'],
  })

export const mintBody = z.object({
  nonce,
  amount: amount.refine((v) => v > 0n, 'quantidade deve ser maior que zero'),
  wait: waitFlag,
})

export const burnBody = z.object({
  tokenId,
  nonce,
  amount: amount.refine((v) => v > 0n, 'quantidade deve ser maior que zero'),
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
