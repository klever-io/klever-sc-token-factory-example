import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { z, type ZodType } from 'zod'

import { badRequest } from './errors.js'

/** Envolve um handler async para que rejeições cheguem no error middleware do Express. */
export const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    handler(req, res).catch(next)
  }

export function parse<T>(schema: ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw badRequest(`${label} inválido`, z.treeifyError(result.error))
  }
  return result.data
}

/** JSON.stringify não sabe serializar bigint; convertemos para string. */
export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)))
}
