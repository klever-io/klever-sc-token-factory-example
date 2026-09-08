import express, { type Express, type NextFunction, type Request, type Response } from 'express'

import { getKlever } from './klever.js'
import { fromPackageRoot } from './lib/paths.js'
import { HttpError, toHttpError } from './lib/errors.js'
import { adminRouter } from './routes/admin.js'
import { contractRouter } from './routes/contract.js'
import { tokensRouter } from './routes/tokens.js'
import { transactionsRouter } from './routes/transactions.js'

export function createApp(): Express {
  const app = express()

  app.use(express.json({ limit: '64kb' }))

  app.get('/health', (_req, res) => {
    const { contractAddress, network, wallet } = getKlever()
    res.json({
      status: 'ok',
      network: network.name,
      chainId: network.chainId,
      contract: contractAddress ?? null,
      signer: wallet?.address ?? null,
    })
  })

  app.use('/api/contract', contractRouter)
  app.use('/api/tokens', tokensRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/tx', transactionsRouter)

  // Frontend estático (public/index.html) na raiz.
  app.use(express.static(fromPackageRoot('public')))

  app.use((_req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' })
  })

  // Error handler: precisa dos 4 parâmetros para o Express reconhecê-lo.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const httpError: HttpError = toHttpError(err)

    // 503 é condição esperada (sem carteira / sem contrato): não polui o log com stack.
    if (httpError.status >= 500 && httpError.status !== 503) {
      console.error('[erro]', err)
    }

    res.status(httpError.status).json({
      error: httpError.message,
      ...(httpError.details ? { details: httpError.details } : {}),
    })
  })

  return app
}
