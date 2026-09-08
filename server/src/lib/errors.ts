/** Erro de aplicação com status HTTP associado. */
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
 * Traduz erros de `require!` do contrato para uma mensagem legível.
 *
 * O nó devolve a mensagem do panic dentro do texto do erro; aqui só garantimos
 * que ela chegue no corpo da resposta em vez de virar um 500 genérico.
 */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err

  const message = err instanceof Error ? err.message : String(err)

  // Reverts do contrato: mensagens vindas de require!/sc_panic!
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

  // Query num endereço que não hospeda o TokenFactory (ou contrato não deployado).
  if (message.includes('does not exist in container') || message.includes('invalid contract')) {
    return new HttpError(
      502,
      'Nenhum TokenFactory respondeu nesse endereço — confira CONTRACT_ADDRESS e a rede',
      { raw: message },
    )
  }

  if (message.includes('Transaction not found') || message.includes('cannot find transaction')) {
    return new HttpError(404, 'Transação não encontrada')
  }

  return new HttpError(500, message)
}
