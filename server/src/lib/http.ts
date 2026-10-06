import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { z, type ZodType } from 'zod'

import { badRequest } from './errors.js'

/** Wraps an async handler so rejections reach the Express error middleware. */
export const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    handler(req, res).catch(next)
  }

export function parse<T>(schema: ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw badRequest(`invalid ${label}`, z.treeifyError(result.error))
  }
  return result.data
}

/** JSON.stringify cannot serialize bigint; we convert it to string. */
export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)))
}
