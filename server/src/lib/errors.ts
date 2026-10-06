/** Application error with an associated HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details)
export const notFound = (message: string) => new HttpError(404, message)
export const unavailable = (message: string) => new HttpError(503, message)

/**
 * Translates contract `require!` errors into a readable message.
 *
 * The node returns the panic message inside the error text; here we only ensure
 * it reaches the response body instead of becoming a generic 500.
 */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err

  const message = err instanceof Error ? err.message : String(err)

  // Contract reverts: messages coming from require!/sc_panic!
  const contractRequire = [
    'Contract is paused',
    'Name cannot be empty',
    'Name too long',
    'Ticker cannot be empty',
    'Ticker too long',
    'Invalid asset type',
    'Precision exceeds maximum',
    'Max supply must be >= initial supply or zero for unlimited',
    'Amount must be greater than zero',
    'Token not issued by this contract',
    'Caller is not the token creator',
    'KLV payment not accepted',
    'No payment received',
    'Single token payment expected',
    'Invalid new owner',
  ].find((m) => message.includes(m))

  if (contractRequire) return new HttpError(400, contractRequire, { raw: message })

  // Query on an address that does not host the TokenFactory (or contract not deployed).
  if (message.includes('does not exist in container') || message.includes('invalid contract')) {
    return new HttpError(
      502,
      'No TokenFactory responded at that address — check CONTRACT_ADDRESS and the network',
      { raw: message },
    )
  }

  if (message.includes('Transaction not found') || message.includes('cannot find transaction')) {
    return new HttpError(404, 'Transaction not found')
  }

  return new HttpError(500, message)
}
