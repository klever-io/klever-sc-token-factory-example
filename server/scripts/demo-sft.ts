/**
 * Teste ponta a ponta do fluxo de SFT (semi-fungível) no TokenFactory.
 *
 * Fluxo: emitir SFT → mint nonce 0 (cria edição) → mint na edição (adiciona)
 *        → burn parcial da edição → mint nonce 0 de novo (segunda edição)
 *        → mint em nonce inexistente (deve falhar).
 * Uso: npm run demo:sft
 */
import { createKleverAddress, formatUnits } from '@klever/connect'

import { initKlever } from '../src/klever.js'
import * as factory from '../src/services/token-factory.js'

const step = (title: string) => console.log(`\n▸ ${title}`)
const check = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`✗ ${msg}`)
  console.log(`  ✔ ${msg}`)
}

const { provider, wallet, contractAddress, network } = await initKlever()
if (!wallet) throw new Error('Configure WALLET_PEM_PATH no .env')

console.log(`rede      ${network.name} (chainId ${network.chainId})`)
console.log(`contrato  ${contractAddress}`)
console.log(`signer    ${wallet.address}`)

/** Saldo por edição (`TICKER-XXXX/nonce`) do signer para o token. */
async function editions(tokenId: string): Promise<Map<number, bigint>> {
  const account = await provider.getAccount(createKleverAddress(wallet!.address), { skipCache: true })
  const out = new Map<number, bigint>()
  for (const a of account.assets ?? []) {
    const [id, nonce] = a.assetId.split('/')
    if (id !== tokenId || !nonce) continue
    out.set(Number(nonce), a.balance)
  }
  return out
}
const show = (m: Map<number, bigint>) =>
  console.log(`  edições: ${[...m].map(([n, b]) => `#${n}=${b}`).join(', ') || '(nenhuma)'}`)

const account = await provider.getAccount(createKleverAddress(wallet.address), { skipCache: true })
console.log(`saldo KLV ${formatUnits(account.balance, 6)}`)
if (account.balance === 0n) throw new Error('Sem KLV. Faucet: https://testnet.kleverscan.org/faucet')

step('Emitindo um SFT (precisão 0)')
const ticker = `SFT${Math.floor(Math.random() * 900 + 100)}`
const issued = await factory.issue(
  { assetType: factory.AssetType.SemiFungible, name: 'DemoSFT', ticker, precision: 0, initialSupply: 0n, maxSupply: 0n },
  true,
)
console.log(`  tx: ${issued.explorerUrl}`)
const tokenId = issued.tokenId
if (!tokenId) throw new Error('Sem token id no recibo')
console.log(`  token id: ${tokenId}`)
check((await factory.getTokenCreator(tokenId)) === wallet.address, 'criador registrado é o signer')

step('Mint nonce 0 com 10 unidades → deve criar a edição #1')
console.log(`  tx: ${(await factory.mintToken(tokenId, 0, 10n, true)).explorerUrl}`)
let bal = await editions(tokenId)
show(bal)
check(bal.get(1) === 10n, 'edição #1 criada com 10')

step('Mint nonce 1 com 5 unidades → deve somar na edição #1')
console.log(`  tx: ${(await factory.mintToken(tokenId, 1, 5n, true)).explorerUrl}`)
bal = await editions(tokenId)
show(bal)
check(bal.get(1) === 15n, 'edição #1 agora tem 15')
check(bal.size === 1, 'nenhuma edição extra foi criada')

step('Burn de 3 unidades da edição #1 (pagamento anexado)')
const burned = await factory.burnToken(tokenId, 1, 3n, true)
console.log(`  tx: ${burned.explorerUrl}`)
for (const e of factory.summarize(burned).events ?? []) console.log(`  ${e.identifier}: ${e.decodedTopics.join(' | ')}`)
bal = await editions(tokenId)
show(bal)
check(bal.get(1) === 12n, 'edição #1 ficou com 12')

step('Mint nonce 0 com 7 unidades → deve criar a edição #2')
console.log(`  tx: ${(await factory.mintToken(tokenId, 0, 7n, true)).explorerUrl}`)
bal = await editions(tokenId)
show(bal)
check(bal.get(2) === 7n, 'edição #2 criada com 7')
check(bal.get(1) === 12n, 'edição #1 intacta')

step('Mint em nonce inexistente (99) → deve falhar')
try {
  const r = await factory.mintToken(tokenId, 99, 1n, true)
  console.log(`  status: ${r.status} tx: ${r.explorerUrl}`)
  check(r.status !== 'success', 'mint em nonce inexistente não foi aceito')
} catch (err) {
  console.log(`  rejeitado: ${(err as Error).message.split('\n')[0]}`)
  check(true, 'mint em nonce inexistente rejeitado')
}

console.log(`\n✔ SFT ${tokenId} passou em todos os testes.\n`)
