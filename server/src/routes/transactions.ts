import { Router } from 'express'

import { createTransactionHash } from '@klever/connect'

import { getKlever } from '../klever.js'
import { badRequest, notFound } from '../lib/errors.js'
import { asyncRoute, jsonSafe } from '../lib/http.js'
import * as factory from '../services/token-factory.js'

export const transactionsRouter: Router = Router()

const assertHash = (hash: unknown): string => {
  if (typeof hash !== 'string') throw badRequest('hash inválido')
  if (!hash || !/^[0-9a-fA-F]{64}$/.test(hash)) {
    throw badRequest('hash deve ter 64 caracteres hexadecimais')
  }
  return hash
}

/** GET /api/tx/:hash — status da transação + eventos decodificados do contrato. */
transactionsRouter.get(
  '/:hash',
  asyncRoute(async (req, res) => {
    const hash = assertHash(req.params.hash)
    const { provider } = getKlever()

    const tx = await provider.getTransaction(createTransactionHash(hash))
    if (!tx) throw notFound(`Transação ${hash} não encontrada`)

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
