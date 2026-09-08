import { Router } from 'express'

import { config } from '../config.js'
import { asyncRoute, jsonSafe, parse } from '../lib/http.js'
import { contractNameBody } from '../lib/schemas.js'
import * as factory from '../services/token-factory.js'

/**
 * Endpoints `#[only_owner]` do contrato.
 *
 * A chamada só passa se a carteira configurada em WALLET_PEM_PATH for a dona
 * do contrato; caso contrário a transação reverte on-chain.
 */
export const adminRouter: Router = Router()

const shouldWait = (wait: boolean | undefined): boolean => wait ?? config.WAIT_FOR_TX

adminRouter.post(
  '/pause',
  asyncRoute(async (req, res) => {
    const wait = shouldWait((req.body as { wait?: boolean } | undefined)?.wait)
    res.json(jsonSafe(factory.summarize(await factory.pause(wait))))
  }),
)

adminRouter.post(
  '/unpause',
  asyncRoute(async (req, res) => {
    const wait = shouldWait((req.body as { wait?: boolean } | undefined)?.wait)
    res.json(jsonSafe(factory.summarize(await factory.unpause(wait))))
  }),
)

adminRouter.post(
  '/name',
  asyncRoute(async (req, res) => {
    const body = parse(contractNameBody, req.body, 'corpo da requisição')
    const result = await factory.changeContractName(body.name, shouldWait(body.wait))
    res.json(jsonSafe({ ...factory.summarize(result), name: body.name }))
  }),
)
