/**
 * Gera uma carteira nova para usar em testnet/devnet e grava o PEM.
 *
 * Uso: npm run wallet:new [-- caminho.pem] [--password senha]
 *   - sem argumentos grava em backend/wallet.pem (default de WALLET_PEM_PATH)
 *   - nunca sobrescreve um arquivo existente
 *   - com --password o PEM sai criptografado (AES-256-GCM), no mesmo formato
 *     que `loadPrivateKeyFromPemFile` do klever-connect lê
 *
 * Formato Klever (igual ao do koperator): base64 da string hex `privkey||pubkey`,
 * cabeçalho `PRIVATE KEY for <endereço>`.
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { generateKeyPair } from '@klever/connect'

import { fromPackageRoot } from '../src/lib/paths.js'

const { values, positionals } = parseArgs({
  options: { password: { type: 'string' } },
  allowPositionals: true,
})

const outPath = fromPackageRoot(positionals[0] ?? 'wallet.pem')
const { privateKey, publicKey } = await generateKeyPair()
const address = publicKey.toAddress()

const keyBytes = Buffer.concat([privateKey.bytes, publicKey.bytes])

const headers: string[] = []
let body = keyBytes
if (values.password) {
  // Mesmo esquema do decryptPemBlock do klever-connect: chave = SHA-256(senha),
  // dados = nonce(12) || ciphertext || tag(16).
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(values.password).digest(), nonce)
  body = Buffer.concat([nonce, cipher.update(keyBytes), cipher.final(), cipher.getAuthTag()])
  headers.push(`DEK-Info: AES-GCM,${nonce.toString('hex')}`, '')
}

const base64 = Buffer.from(body.toString('hex')).toString('base64')
const pem = [
  `-----BEGIN PRIVATE KEY for ${address}-----`,
  ...headers,
  ...(base64.match(/.{1,64}/g) ?? []),
  `-----END PRIVATE KEY for ${address}-----`,
  '',
].join('\n')

writeFileSync(outPath, pem, { flag: 'wx', mode: 0o600 })

console.log(`
  Carteira gerada (use APENAS em testnet/devnet)
  ────────────────────────────────────────────────
  endereço       ${address}
  chave pública  ${publicKey.hex}
  arquivo        ${outPath}${values.password ? ' (criptografado)' : ''}

  No .env:
  WALLET_PEM_PATH=${positionals[0] ?? './wallet.pem'}${values.password ? '\n  WALLET_PEM_PASSWORD=<a senha usada>' : ''}

  Faucet de testnet: https://testnet.kleverscan.org/faucet
`)
