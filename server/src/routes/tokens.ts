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

/** The body can override the .env default per request. */
const shouldWait = (wait: boolean | undefined): boolean => wait ?? config.WAIT_FOR_TX

/**
 * POST /api/tokens — issues a new KDA.
 *
 * Amounts come in minimum units: with precision 6, "1000000" = 1 token.
 */
tokensRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const body = parse(issueBody, req.body, 'request body')

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

/** POST /api/tokens/burn — burns tokens sent along with the call.
 *
 * The tokenId goes in the body, not the URL, because burning is a payment attached
 * to the transaction: `burnToken` is `#[payable("*")]` and takes no arguments.
 */
tokensRouter.post(
  '/burn',
  asyncRoute(async (req, res) => {
    const body = parse(burnBody, req.body, 'request body')

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

/** POST /api/tokens/:tokenId/mint — mints additional supply (creator only). */
tokensRouter.post(
  '/:tokenId/mint',
  asyncRoute(async (req, res) => {
    const id = parse(tokenIdSchema, req.params.tokenId, 'tokenId')
    const body = parse(mintBody, req.body, 'request body')

    const result = await factory.mintToken(id, body.nonce, body.amount, shouldWait(body.wait))

    res.json(
      jsonSafe({ ...factory.summarize(result), tokenId: id, nonce: body.nonce, amount: body.amount }),
    )
  }),
)

/**
 * POST /api/tokens/:tokenId/transfer-ownership — transfers the on-chain ownership
 * of the asset to another address. Irreversible: the contract loses control.
 */
tokensRouter.post(
  '/:tokenId/transfer-ownership',
  asyncRoute(async (req, res) => {
    const id = parse(tokenIdSchema, req.params.tokenId, 'tokenId')
    const body = parse(transferOwnershipBody, req.body, 'request body')

    const result = await factory.transferTokenOwnership(id, body.newOwner, shouldWait(body.wait))

    res.json(jsonSafe({ ...factory.summarize(result), tokenId: id, newOwner: body.newOwner }))
  }),
)

/** GET /api/tokens?creator=klv1…&offset=0&limit=20 — pagination runs in the contract. */
tokensRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const creator = parse(kleverAddress, req.query.creator, 'creator')
    const { offset, limit } = parse(paginationQuery, req.query, 'pagination')

    const [tokens, total] = await Promise.all([
      factory.getTokensByCreator(creator, offset, limit),
      factory.getCreatorTokenCount(creator),
    ])

    res.json({ creator, total, offset, limit, tokens })
  }),
)

/**
 * GET /api/tokens/:tokenId — creator registered in the contract + asset data
 * (name, precision, supply, properties) coming from the network indexer.
 */
tokensRouter.get(
  '/:tokenId',
  asyncRoute(async (req, res) => {
    const id = parse(tokenIdSchema, req.params.tokenId, 'tokenId')
    const [creator, asset] = await Promise.all([factory.getTokenCreator(id), getAssetInfo(id)])

    if (!creator && !asset) {
      throw notFound(`Token ${id} was not issued by this contract and does not exist on the network`)
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
