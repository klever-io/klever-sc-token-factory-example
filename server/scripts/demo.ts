/**
 * Demonstração ponta a ponta da integração com o TokenFactory.
 *
 * Fluxo: views → emitir token fungível → mintar → listar → queimar.
 * Uso: npm run demo
 *
 * Requer CONTRACT_ADDRESS e WALLET_PEM_PATH no .env, com KLV para as taxas.
 */
import { createKleverAddress, formatUnits } from '@klever/connect'

import { initKlever } from '../src/klever.js'
import * as factory from '../src/services/token-factory.js'

const step = (title: string) => console.log(`\n▸ ${title}`)

const { provider, wallet, contractAddress, network } = await initKlever()

if (!wallet) throw new Error('Configure WALLET_PEM_PATH no .env para rodar a demo')

console.log(`rede      ${network.name} (chainId ${network.chainId})`)
console.log(`contrato  ${contractAddress}`)
console.log(`signer    ${wallet.address}`)

step('Estado do contrato (views — sem taxa)')
const [paused, totalIssued] = await Promise.all([factory.isPaused(), factory.getTotalIssued()])
console.log(`  pausado:      ${paused}`)
console.log(`  total emitido: ${totalIssued}`)

if (paused) throw new Error('Contrato pausado — o owner precisa chamar unpause')

const account = await provider.getAccount(createKleverAddress(wallet.address), { skipCache: true })
console.log(`  saldo KLV:    ${formatUnits(account.balance, 6)}`)
if (account.balance === 0n) {
  throw new Error('Sem KLV para pagar taxas. Use o faucet: https://testnet.kleverscan.org/faucet')
}

step('Emitindo um token fungível')
const precision = 6
const initialSupply = 1_000n * 10n ** BigInt(precision)
const ticker = `DEMO${Math.floor(Math.random() * 900 + 100)}`

const issued = await factory.issue(
  {
    assetType: factory.AssetType.Fungible,
    name: 'DemoToken',
    ticker,
    precision,
    initialSupply,
    maxSupply: initialSupply * 10n,
  },
  true,
)

console.log(`  tx:       ${issued.explorerUrl}`)
console.log(`  token id: ${issued.tokenId ?? '(não identificado no recibo)'}`)

const tokenId = issued.tokenId
if (!tokenId) {
  console.log('\n  Sem token id no recibo — confira a transação no explorer e siga manualmente.')
  process.exit(0)
}

step('Consultando o criador registrado')
console.log(`  criador: ${await factory.getTokenCreator(tokenId)}`)

step('Mintando 500 unidades a mais')
const mintAmount = 500n * 10n ** BigInt(precision)
const minted = await factory.mintToken(tokenId, 0, mintAmount, true)
console.log(`  tx: ${minted.explorerUrl}`)

step('Listando tokens desse criador')
const tokens = await factory.getTokensByCreator(wallet.address, 0, 20)
const count = await factory.getCreatorTokenCount(wallet.address)
console.log(`  total: ${count}`)
console.log(`  itens: ${tokens.join(', ')}`)

step('Queimando 100 unidades (pagamento anexado à chamada)')
const burnAmount = 100n * 10n ** BigInt(precision)
const burned = await factory.burnToken(tokenId, 0, burnAmount, true)
console.log(`  tx: ${burned.explorerUrl}`)

step('Eventos da última transação')
for (const event of factory.summarize(burned).events ?? []) {
  console.log(`  ${event.identifier}: ${event.decodedTopics.join(' | ')}`)
}

console.log(`\n✔ Demo concluída. Token ${tokenId} criado, mintado e parcialmente queimado.\n`)
