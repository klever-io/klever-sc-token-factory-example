import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ContractFactory, createTransactionHash } from "@klever/connect";

import { config } from "../config.js";
import { getKlever, setContractAddress } from "../klever.js";
import { unavailable } from "../lib/errors.js";
import { fromPackageRoot } from "../lib/paths.js";

export interface DeployResult {
  address: string;
  hash: string;
  status: "success";
  explorerUrl: string;
  /** Whether the address was written to .env (a write failure does not abort the deploy). */
  persisted: boolean;
}

/** The wasm must exist for the deploy; without a contract build there is nothing to send. */
export function wasmPath(): string {
  return fromPackageRoot(config.WASM_PATH);
}

export function wasmAvailable(): boolean {
  return existsSync(wasmPath());
}

function loadBytecode(): Uint8Array {
  const path = wasmPath();
  try {
    return new Uint8Array(readFileSync(path));
  } catch (err) {
    throw unavailable(
      `Could not find the wasm at ${path}. Run the contract build (\`~/klever-sdk/ksc all build\`) or adjust WASM_PATH. Cause: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Deploys the TokenFactory with the backend wallet and starts using the new
 * address immediately. Used by the `npm run deploy:contract` script and by
 * `POST /api/contract/deploy`.
 */
export async function deployContract(): Promise<DeployResult> {
  const { provider, wallet, abi } = getKlever();
  if (!wallet) {
    throw unavailable(
      "Server in read-only mode: set WALLET_PEM_PATH to deploy",
    );
  }

  const bytecode = loadBytecode();

  // Deploy metadata: upgradeable allows `upgrade()` later; payable is
  // required because `burnToken` receives KDA.
  const factory = new ContractFactory(abi, bytecode, wallet, {
    upgradeable: true,
    readable: true,
    payable: true,
    payableBySC: true,
  });

  // The TokenFactory constructor `init()` takes no arguments.
  const deployed = await factory.deploy();
  const { hash } = (
    deployed as unknown as { deployTransaction: { hash: string } }
  ).deployTransaction;

  const receipt = await provider.waitForTransaction(
    createTransactionHash(String(hash)),
  );
  if (!receipt) {
    throw new Error(
      `Transaction ${hash} did not confirm in time — check the explorer`,
    );
  }

  // The parser uses the receipt type from the contracts package (with branded hash); the
  // provider response is structurally compatible.
  const address = ContractFactory.getDeployedAddress(
    receipt as unknown as Parameters<
      typeof ContractFactory.getDeployedAddress
    >[0],
  );

  setContractAddress(address);

  return {
    address,
    hash: String(hash),
    status: "success",
    explorerUrl: provider.getTransactionUrl(String(hash)),
    persisted: persistContractAddress(address),
  };
}

/**
 * Writes CONTRACT_ADDRESS to .env so the address survives a restart.
 * Replaces the existing line (even if empty) or appends at the end. Only
 * called when no contract was configured yet, so it never overwrites
 * an address in use.
 */
export function persistContractAddress(address: string): boolean {
  const envPath = join(fromPackageRoot("."), ".env");
  const line = `CONTRACT_ADDRESS=${address}`;
  try {
    const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    const pattern = /^CONTRACT_ADDRESS=.*$/m;
    const next = pattern.test(current)
      ? current.replace(pattern, line)
      : `${current}${current.endsWith("\n") || current === "" ? "" : "\n"}${line}\n`;
    writeFileSync(envPath, next);
    return true;
  } catch (err) {
    console.warn(
      `[deploy] could not write ${line} to ${envPath}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
