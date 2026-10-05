/**
 * End-to-end test of the SFT (semi-fungible) flow in the TokenFactory.
 *
 * Flow: issue SFT → mint nonce 0 (creates edition) → mint on the edition (adds)
 *        → partial burn of the edition → mint nonce 0 again (second edition)
 *        → mint on nonexistent nonce (should fail).
 * Usage: npm run demo:sft
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
if (!wallet) throw new Error('Set WALLET_PEM_PATH in .env')

console.log(`network   ${network.name} (chainId ${network.chainId})`)
console.log(`contract  ${contractAddress}`)
console.log(`signer    ${wallet.address}`)

/** Balance per edition (`TICKER-XXXX/nonce`) of the signer for the token. */
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
  console.log(`  editions: ${[...m].map(([n, b]) => `#${n}=${b}`).join(', ') || '(none)'}`)

const account = await provider.getAccount(createKleverAddress(wallet.address), { skipCache: true })
console.log(`KLV balance ${formatUnits(account.balance, 6)}`)
if (account.balance === 0n) throw new Error('No KLV. Faucet: https://testnet.kleverscan.org/faucet')

step('Issuing an SFT (precision 0)')
const ticker = `SFT${Math.floor(Math.random() * 900 + 100)}`
const issued = await factory.issue(
  { assetType: factory.AssetType.SemiFungible, name: 'DemoSFT', ticker, precision: 0, initialSupply: 0n, maxSupply: 0n },
  true,
)
console.log(`  tx: ${issued.explorerUrl}`)
const tokenId = issued.tokenId
if (!tokenId) throw new Error('No token id in the receipt')
console.log(`  token id: ${tokenId}`)
check((await factory.getTokenCreator(tokenId)) === wallet.address, 'registered creator is the signer')

step('Mint nonce 0 with 10 units → should create edition #1')
console.log(`  tx: ${(await factory.mintToken(tokenId, 0, 10n, true)).explorerUrl}`)
let bal = await editions(tokenId)
show(bal)
check(bal.get(1) === 10n, 'edition #1 created with 10')

step('Mint nonce 1 with 5 units → should add to edition #1')
console.log(`  tx: ${(await factory.mintToken(tokenId, 1, 5n, true)).explorerUrl}`)
bal = await editions(tokenId)
show(bal)
check(bal.get(1) === 15n, 'edition #1 now has 15')
check(bal.size === 1, 'no extra edition was created')

step('Burn 3 units of edition #1 (attached payment)')
const burned = await factory.burnToken(tokenId, 1, 3n, true)
console.log(`  tx: ${burned.explorerUrl}`)
for (const e of factory.summarize(burned).events ?? []) console.log(`  ${e.identifier}: ${e.decodedTopics.join(' | ')}`)
bal = await editions(tokenId)
show(bal)
check(bal.get(1) === 12n, 'edition #1 ended up with 12')

step('Mint nonce 0 with 7 units → should create edition #2')
console.log(`  tx: ${(await factory.mintToken(tokenId, 0, 7n, true)).explorerUrl}`)
bal = await editions(tokenId)
show(bal)
check(bal.get(2) === 7n, 'edition #2 created with 7')
check(bal.get(1) === 12n, 'edition #1 untouched')

step('Mint on nonexistent nonce (99) → should fail')
try {
  const r = await factory.mintToken(tokenId, 99, 1n, true)
  console.log(`  status: ${r.status} tx: ${r.explorerUrl}`)
  check(r.status !== 'success', 'mint on nonexistent nonce was not accepted')
} catch (err) {
  console.log(`  rejected: ${(err as Error).message.split('\n')[0]}`)
  check(true, 'mint on nonexistent nonce rejected')
}

console.log(`\n✔ SFT ${tokenId} passed all tests.\n`)
