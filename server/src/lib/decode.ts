/**
 * Utilitários de decodificação para logs e recibos.
 *
 * O nó da Klever devolve topics/data como hex ou base64 dependendo do endpoint,
 * então tentamos os dois e ficamos com o que vira texto imprimível.
 */

const PRINTABLE = /^[\x20-\x7e]+$/
const HEX = /^(?:[0-9a-fA-F]{2})+$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const TOKEN_ID = /^[A-Z0-9]{2,20}-[A-Z0-9]{4,8}$/

/** Um id de KDA tem o formato `TICKER-XXXX`. */
export const looksLikeTokenId = (value: string): boolean => TOKEN_ID.test(value)

function toText(value: string, encoding: 'hex' | 'base64'): string | null {
  const buf = Buffer.from(value, encoding)
  if (buf.length === 0) return null
  const text = buf.toString('utf8')
  return PRINTABLE.test(text) ? text : null
}

/**
 * Tenta transformar um topic/data em texto legível.
 * Devolve null quando o conteúdo é binário (endereço, BigUint, u8 etc.).
 */
export function decodeLogPayload(value: string | undefined): string | null {
  if (!value) return null
  if (HEX.test(value)) {
    const text = toText(value, 'hex')
    if (text) return text
  }
  if (BASE64.test(value) && value.length % 4 === 0) {
    return toText(value, 'base64')
  }
  return null
}
