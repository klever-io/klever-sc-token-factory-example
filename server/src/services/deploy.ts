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
  /** Se o endereço foi gravado no .env (falha na escrita não derruba o deploy). */
  persisted: boolean;
}

/** O wasm precisa existir para o deploy; sem build do contrato não há o que enviar. */
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
      `Não encontrei o wasm em ${path}. Rode o build do contrato (\`~/klever-sdk/ksc all build\`) ou ajuste WASM_PATH. Causa: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Faz o deploy do TokenFactory com a carteira do backend e passa a usar o novo
 * endereço imediatamente. Usado pelo script `npm run deploy:contract` e por
 * `POST /api/contract/deploy`.
 */
export async function deployContract(): Promise<DeployResult> {
  const { provider, wallet, abi } = getKlever();
  if (!wallet) {
    throw unavailable(
      "Servidor em modo somente-leitura: configure WALLET_PEM_PATH para fazer o deploy",
    );
  }

  const bytecode = loadBytecode();

  // Metadata do deploy: upgradeable permite `upgrade()` depois; payable é
  // necessário porque `burnToken` recebe KDA.
  const factory = new ContractFactory(abi, bytecode, wallet, {
    upgradeable: true,
    readable: true,
    payable: true,
    payableBySC: true,
  });

  // O construtor `init()` do TokenFactory não recebe argumentos.
  const deployed = await factory.deploy();
  const { hash } = (
    deployed as unknown as { deployTransaction: { hash: string } }
  ).deployTransaction;

  const receipt = await provider.waitForTransaction(
    createTransactionHash(String(hash)),
  );
  if (!receipt) {
    throw new Error(
      `Transação ${hash} não confirmou a tempo — confira no explorer`,
    );
  }

  // O parser usa o tipo de recibo do pacote de contratos (com hash branded); a
  // resposta do provider é estruturalmente compatível.
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
 * Grava CONTRACT_ADDRESS no .env para o endereço sobreviver a um restart.
 * Substitui a linha existente (mesmo vazia) ou acrescenta ao final. Só é
 * chamado quando ainda não havia contrato configurado, então nunca sobrescreve
 * um endereço em uso.
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
      `[deploy] não consegui gravar ${line} em ${envPath}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
