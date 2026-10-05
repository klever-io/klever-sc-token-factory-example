import { Router } from 'express'

import { config } from '../config.js'
import { asyncRoute, jsonSafe, parse } from '../lib/http.js'
import { contractNameBody } from '../lib/schemas.js'
import * as factory from '../services/token-factory.js'

/**
 * `#[only_owner]` endpoints of the contract.
 *
 * The call only goes through if the wallet configured in WALLET_PEM_PATH is the owner
 * of the contract; otherwise the transaction reverts on-chain.
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
    const body = parse(contractNameBody, req.body, 'request body')
    const result = await factory.changeContractName(body.name, shouldWait(body.wait))
    res.json(jsonSafe({ ...factory.summarize(result), name: body.name }))
  }),
)
