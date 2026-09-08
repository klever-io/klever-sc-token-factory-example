import { Router } from 'express'

import { config } from '../config.js'
import { getKlever } from '../klever.js'
import { notFound } from '../lib/errors.js'
import { asyncRoute, jsonSafe, parse } from '../lib/http.js'
import {
  burnBody,
  issueBody,
  kleverAddress,
  mintBody,
  paginationQuery,
  tokenId as tokenIdSchema,
  transferOwnershipBody,
} from '../lib/schemas.js'
import { getAssetInfo } from '../services/assets.js'
import * as factory from '../services/token-factory.js'

export const tokensRouter: Router = Router()

/** O corpo pode sobrepor o default do .env por requisição. */
const shouldWait = (wait: boolean | undefined): boolean => wait ?? config.WAIT_FOR_TX

/**
 * POST /api/tokens — emite um novo KDA.
 *
 * Quantidades vêm em unidades mínimas: com precision 6, "1000000" = 1 token.
 */
tokensRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const body = parse(issueBody, req.body, 'corpo da requisição')

    const result = await factory.issue(
      {
        assetType: body.assetType,
        name: body.name,
        ticker: body.ticker,
        precision: body.precision,
        initialSupply: body.initialSupply,
        maxSupply: body.maxSupply,
      },
      shouldWait(body.wait),
    )

    res.status(201).json(
      jsonSafe({
        ...factory.summarize(result),
        assetType: factory.assetTypeName(body.assetType),
        request: {
          name: body.name,
          ticker: body.ticker,
          precision: body.precision,
          initialSupply: body.initialSupply,
          maxSupply: body.maxSupply,
        },
      }),
    )
  }),
)

/** POST /api/tokens/burn — queima tokens enviados junto com a chamada.
 *
 * O tokenId vai no corpo, e não na URL, porque a queima é um pagamento anexado
 * à transação: `burnToken` é `#[payable("*")]` e não recebe argumentos.
 */
tokensRouter.post(
  '/burn',
  asyncRoute(async (req, res) => {
    const body = parse(burnBody, req.body, 'corpo da requisição')

    const result = await factory.burnToken(
      body.tokenId,
      body.nonce,
      body.amount,
      shouldWait(body.wait),
    )

    res.json(
      jsonSafe({
        ...factory.summarize(result),
        tokenId: body.tokenId,
        nonce: body.nonce,
        amount: body.amount,
      }),
    )
  }),
)

/** POST /api/tokens/:tokenId/mint — minta supply adicional (só o criador). */
tokensRouter.post(
  '/:tokenId/mint',
  asyncRoute(async (req, res) => {
    const id = parse(tokenIdSchema, req.params.tokenId, 'tokenId')
    const body = parse(mintBody, req.body, 'corpo da requisição')

    const result = await factory.mintToken(id, body.nonce, body.amount, shouldWait(body.wait))

    res.json(
      jsonSafe({ ...factory.summarize(result), tokenId: id, nonce: body.nonce, amount: body.amount }),
    )
  }),
)

/**
 * POST /api/tokens/:tokenId/transfer-ownership — passa a propriedade on-chain
 * do ativo para outro endereço. Irreversível: o contrato perde o controle.
 */
tokensRouter.post(
  '/:tokenId/transfer-ownership',
  asyncRoute(async (req, res) => {
    const id = parse(tokenIdSchema, req.params.tokenId, 'tokenId')
    const body = parse(transferOwnershipBody, req.body, 'corpo da requisição')

    const result = await factory.transferTokenOwnership(id, body.newOwner, shouldWait(body.wait))

    res.json(jsonSafe({ ...factory.summarize(result), tokenId: id, newOwner: body.newOwner }))
  }),
)

/** GET /api/tokens?creator=klv1…&offset=0&limit=20 — a paginação roda no contrato. */
tokensRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const creator = parse(kleverAddress, req.query.creator, 'creator')
    const { offset, limit } = parse(paginationQuery, req.query, 'paginação')

    const [tokens, total] = await Promise.all([
      factory.getTokensByCreator(creator, offset, limit),
      factory.getCreatorTokenCount(creator),
    ])

    res.json({ creator, total, offset, limit, tokens })
  }),
)

/**
 * GET /api/tokens/:tokenId — criador registrado no contrato + dados do ativo
 * (nome, precisão, supply, propriedades) vindos do indexer da rede.
 */
tokensRouter.get(
  '/:tokenId',
  asyncRoute(async (req, res) => {
    const id = parse(tokenIdSchema, req.params.tokenId, 'tokenId')
    const [creator, asset] = await Promise.all([factory.getTokenCreator(id), getAssetInfo(id)])

    if (!creator && !asset) {
      throw notFound(`Token ${id} não foi emitido por este contrato nem existe na rede`)
    }

    const { network } = getKlever()
    res.json({
      tokenId: id,
      creator,
      managedByContract: Boolean(creator),
      asset,
      explorerUrl: `${network.config.explorer}/asset/${id}`,
    })
  }),
)
