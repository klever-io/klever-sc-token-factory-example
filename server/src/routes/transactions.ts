import { Router } from 'express'

import { createTransactionHash } from '@klever/connect'

import { getKlever } from '../klever.js'
import { badRequest, notFound } from '../lib/errors.js'
import { asyncRoute, jsonSafe } from '../lib/http.js'
import * as factory from '../services/token-factory.js'

export const transactionsRouter: Router = Router()

const assertHash = (hash: unknown): string => {
  if (typeof hash !== 'string') throw badRequest('invalid hash')
  if (!hash || !/^[0-9a-fA-F]{64}$/.test(hash)) {
    throw badRequest('hash must be 64 hexadecimal characters')
  }
  return hash
}

/** GET /api/tx/:hash — transaction status + decoded contract events. */
transactionsRouter.get(
  '/:hash',
  asyncRoute(async (req, res) => {
    const hash = assertHash(req.params.hash)
    const { provider } = getKlever()

    const tx = await provider.getTransaction(createTransactionHash(hash))
    if (!tx) throw notFound(`Transaction ${hash} not found`)

    res.json(
      jsonSafe({
        hash,
        status: tx.status,
        block: tx.blockNum,
        sender: tx.sender,
        feeKLV: tx.totalFee,
        resultCode: tx.resultCode,
        explorerUrl: provider.getTransactionUrl(hash),
        events: factory.decodeEvents(tx),
      }),
    )
  }),
)
