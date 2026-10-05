/**
 * Deploys the TokenFactory and writes the address to CONTRACT_ADDRESS in .env.
 *
 * Usage: npm run deploy:contract
 * Requires: WALLET_PEM_PATH in .env, KLV in the account and the wasm at WASM_PATH.
 * The same routine is exposed on the page at `POST /api/contract/deploy`.
 */
import { initKlever } from "../src/klever.js";
import { deployContract, wasmPath } from "../src/services/deploy.js";

const { provider, wallet, contractAddress } = await initKlever();
if (!wallet)
  throw new Error("Set WALLET_PEM_PATH in .env to deploy");

console.log(
  `network   ${provider.network.name} (chainId ${provider.network.chainId})`,
);
console.log(`deployer  ${wallet.address}`);
console.log(`wasm      ${wasmPath()}`);
if (contractAddress)
  console.log(`current   ${contractAddress} (will be replaced in .env)`);

console.log("\nsending deploy and waiting for confirmation…");
const result = await deployContract();

console.log(`
  Deploy complete
  ────────────────────────────────────────────────
  contract   ${result.address}
  tx         ${result.explorerUrl}
  .env       ${result.persisted ? "CONTRACT_ADDRESS updated" : `not written — set CONTRACT_ADDRESS=${result.address}`}
`);
