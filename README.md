# TokenFactory

KDA token factory on Klever: a Rust smart contract that issues, mints, and burns tokens (fungible, NFT, and SFT), and a Node server with a web page to operate the contract.

```
token-factory/   contract (Rust → wasm)
server/          Express backend + frontend in server/public
```

## Prerequisites

- Node 20 or newer
- Rust and the Klever SDK in `~/klever-sdk` (only to build the contract)
- A wallet with testnet KLV to pay fees

## Running in 4 steps

### 1. Build the contract

```bash
cd token-factory
~/klever-sdk/ksc all build
```

Produces `output/token-factory.wasm` and `output/token-factory.abi.json`. The server reads both from there.

### 2. Configure the server

```bash
cd server
npm install
cp .env.example .env
```

The `.env` already points to testnet and to the artifacts from step 1. Only the wallet is missing:

```bash
npm run wallet:new      # creates walletKey.pem and prints the address
```

Get test KLV for that address from the faucet: <https://testnet.kleverscan.org/faucet>

Already have a wallet in Klever PEM format? Point `WALLET_PEM_PATH` to it.

### 3. Start the server

```bash
npm run dev             # reloads on code changes
```

Open <http://localhost:3000>.

### 4. Deploy the contract

On first run the page shows the **No TokenFactory configured** card. Click **Deploy contract**: the backend deploys the contract with your wallet, starts using it immediately, and writes the address to `CONTRACT_ADDRESS` in `.env`.

Prefer the terminal? `npm run deploy:contract` does the same thing.

Already have a live contract? Set its address in `CONTRACT_ADDRESS` before starting the server and skip this step.

## After that

Everything happens through the page: issue tokens, mint, burn, transfer ownership, pause the contract. The REST API behind it is documented in `server/src/routes`.

Automated flows from the terminal, useful to check that everything works:

```bash
npm run demo            # issues a fungible token, mints, lists, and burns
npm run demo:sft        # issues an SFT, creates editions, mints by nonce, and burns
```

## Troubleshooting

**I edited `.env` and nothing changed.** The file is read only at boot. Stop the server and start it again, even with `npm run dev`.

**I started the server and the page still shows the old state.** Another process probably still holds port 3000 and the new one could not bind. Find what is on the port and kill it:

```bash
lsof -ti :3000 | xargs kill
```

**"Wasm not found".** Step 1 is missing, or `WASM_PATH` in `.env` points elsewhere.

**NFT mint rejected with "invalid argument".** The network limits mints to 50 NFTs per transaction. Split into batches.

**Server in read-only mode.** Without `WALLET_PEM_PATH` the server starts but only answers queries. Configure the wallet to issue, mint, and burn.
