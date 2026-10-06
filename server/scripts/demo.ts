/**
 * End-to-end demonstration of the TokenFactory integration.
 *
 * Flow: views → issue fungible token → mint → list → burn.
 * Usage: npm run demo
 *
 * Requires CONTRACT_ADDRESS and WALLET_PEM_PATH in .env, with KLV for fees.
 */
import { createKleverAddress, formatUnits } from '@klever/connect'

import { initKlever } from '../src/klever.js'
import * as factory from '../src/services/token-factory.js'

const step = (title: string) => console.log(`\n▸ ${title}`)

const { provider, wallet, contractAddress, network } = await initKlever()

if (!wallet) throw new Error('Set WALLET_PEM_PATH in .env to run the demo')

console.log(`network   ${network.name} (chainId ${network.chainId})`)
console.log(`contract  ${contractAddress}`)
console.log(`signer    ${wallet.address}`)

step('Contract state (views — no fee)')
const [paused, totalIssued] = await Promise.all([factory.isPaused(), factory.getTotalIssued()])
console.log(`  paused:       ${paused}`)
console.log(`  total issued: ${totalIssued}`)

if (paused) throw new Error('Contract paused — the owner must call unpause')

const account = await provider.getAccount(createKleverAddress(wallet.address), { skipCache: true })
console.log(`  KLV balance:  ${formatUnits(account.balance, 6)}`)
if (account.balance === 0n) {
  throw new Error('No KLV to pay fees. Use the faucet: https://testnet.kleverscan.org/faucet')
}

step('Issuing a fungible token')
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
console.log(`  token id: ${issued.tokenId ?? '(not identified in the receipt)'}`)

const tokenId = issued.tokenId
if (!tokenId) {
  console.log('\n  No token id in the receipt — check the transaction in the explorer and proceed manually.')
  process.exit(0)
}

step('Querying the registered creator')
console.log(`  creator: ${await factory.getTokenCreator(tokenId)}`)

step('Minting 500 more units')
const mintAmount = 500n * 10n ** BigInt(precision)
const minted = await factory.mintToken(tokenId, 0, mintAmount, true)
console.log(`  tx: ${minted.explorerUrl}`)

step('Listing the tokens of this creator')
const tokens = await factory.getTokensByCreator(wallet.address, 0, 20)
const count = await factory.getCreatorTokenCount(wallet.address)
console.log(`  total: ${count}`)
console.log(`  items: ${tokens.join(', ')}`)

step('Burning 100 units (payment attached to the call)')
const burnAmount = 100n * 10n ** BigInt(precision)
const burned = await factory.burnToken(tokenId, 0, burnAmount, true)
console.log(`  tx: ${burned.explorerUrl}`)

step('Events of the last transaction')
for (const event of factory.summarize(burned).events ?? []) {
  console.log(`  ${event.identifier}: ${event.decodedTopics.join(' | ')}`)
}

console.log(`\n✔ Demo complete. Token ${tokenId} created, minted and partially burned.\n`)
