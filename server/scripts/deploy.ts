/**
 * Faz o deploy do TokenFactory e grava o endereço em CONTRACT_ADDRESS no .env.
 *
 * Uso: npm run deploy:contract
 * Requer: WALLET_PEM_PATH no .env, KLV na conta e o wasm em WASM_PATH.
 * A mesma rotina está exposta na página em `POST /api/contract/deploy`.
 */
import { initKlever } from "../src/klever.js";
import { deployContract, wasmPath } from "../src/services/deploy.js";

const { provider, wallet, contractAddress } = await initKlever();
if (!wallet)
  throw new Error("Configure WALLET_PEM_PATH no .env para fazer o deploy");

console.log(
  `rede      ${provider.network.name} (chainId ${provider.network.chainId})`,
);
console.log(`deployer  ${wallet.address}`);
console.log(`wasm      ${wasmPath()}`);
if (contractAddress)
  console.log(`atual     ${contractAddress} (será substituído no .env)`);

console.log("\nenviando deploy e aguardando confirmação…");
const result = await deployContract();

console.log(`
  Deploy concluído
  ────────────────────────────────────────────────
  contrato   ${result.address}
  tx         ${result.explorerUrl}
  .env       ${result.persisted ? "CONTRACT_ADDRESS atualizado" : `não gravado — coloque CONTRACT_ADDRESS=${result.address}`}
`);
