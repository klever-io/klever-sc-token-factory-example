# TokenFactory — Backend Node.js

Backend de exemplo que integra com o smart contract **TokenFactory** (`../token-factory`)
na Klever usando o SDK [`@klever/connect`](https://www.npmjs.com/package/@klever/connect).

Cobre todos os endpoints do contrato: emissão de KDA (Fungible / NFT / SFT), mint,
burn com pagamento anexado, transferência de propriedade do ativo, endpoints de
admin (`only_owner`) e todas as views — além da leitura dos eventos emitidos.

---

## Como o klever-connect entra

| Peça do SDK | Onde | Para quê |
|---|---|---|
| `KleverProvider` | `src/klever.ts` | conexão com o nó (mainnet/testnet/devnet/local ou URL própria) |
| `NodeWallet` + `loadPrivateKeyFromPemFile` | `src/klever.ts` | assina as transações do backend com a chave do arquivo PEM |
| `Contract` | `src/klever.ts` | instância do TokenFactory montada a partir do ABI gerado pelo build |
| `contract.call()` | `src/services/token-factory.ts` | views (`queryContract`) — sem taxa e sem transação |
| `contract.invoke()` | `src/services/token-factory.ts` | endpoints mutáveis — monta, assina e faz broadcast |
| `contract.parseEvents()` | `src/services/token-factory.ts` | eventos do contrato nos logs da transação |
| `ContractFactory` | `scripts/deploy.ts` | deploy do wasm e leitura do endereço no recibo |
| `generateKeyPair` | `scripts/new-wallet.ts` | criar uma carteira de teste e gravar o PEM |

O `Contract` gera métodos dinâmicos a partir do ABI (`contract.issue(...)`), mas
eles chegam como `unknown` no TypeScript. Por isso o serviço usa `call()` e
`invoke()`, que são tipados, e expõe funções com tipos concretos.

---

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Preencha o `.env`:

```bash
# 1. gere uma carteira de teste (grava backend/wallet.pem e imprime o endereço)
npm run wallet:new

# 2. pegue KLV no faucet de testnet para o endereço gerado
#    https://testnet.kleverscan.org/faucet

# 3. confira WALLET_PEM_PATH (default ./wallet.pem) e faça o deploy do contrato.
#    O script grava o endereço em CONTRACT_ADDRESS no .env.
npm run deploy:contract
```

Prefere pela página? Suba o servidor sem `CONTRACT_ADDRESS`: ele abre em modo
"não configurado" e o frontend mostra um card **Fazer deploy do contrato**
(`POST /api/contract/deploy`). O endereço novo entra em uso na hora e é gravado
no `.env`. Com `CONTRACT_ADDRESS` definido a rota responde `409`, para ninguém
trocar o contrato em uso por um clique.

O deploy exige que o wasm exista. Se ainda não buildou o contrato:

```bash
cd ../token-factory && ~/klever-sdk/ksc all build
```

Rodando:

```bash
npm run dev      # tsx watch
npm start        # tsx, sem watch
npm run build && npm run serve   # compilado
npm run demo     # fluxo ponta a ponta pelo terminal (token fungível)
npm run demo:sft # fluxo ponta a ponta de SFT: edições, mint por nonce, burn
```

Já tem uma carteira? Qualquer PEM no formato Klever serve (o gerado pelo
`koperator account create`, por exemplo): aponte `WALLET_PEM_PATH` para ele.

Sem `WALLET_PEM_PATH` o servidor sobe em **modo somente-leitura**: as views
funcionam normalmente e os endpoints de escrita respondem `503`.

---

## Frontend

Com o servidor no ar, abra **http://localhost:3000**. É uma página estática
(`public/`, sem build) que fala só com `/api`:

- lista os tokens de um criador (default: a carteira do backend), com paginação;
- mostra os dados de um token: criador registrado no contrato, dono on-chain,
  precisão, supplies, propriedades do KDA, link para o explorer;
- executa mint, burn e transferência de propriedade no token selecionado;
- emite tokens novos e chama pause / unpause / rename do contrato;
- registra cada transação com status, link da tx e eventos decodificados.

Quantidades são digitadas em unidades humanas (`1.5`) e convertidas para
unidades mínimas com a precisão do token antes de chegar na API.

---

## Variáveis de ambiente

| Variável | Default | Descrição |
|---|---|---|
| `PORT` | `3000` | porta HTTP |
| `KLEVER_NETWORK` | `testnet` | `mainnet` \| `testnet` \| `devnet` \| `local` |
| `KLEVER_NODE_URL` | — | nó próprio; exige `KLEVER_CHAIN_ID` |
| `KLEVER_API_URL` | — | API própria (usa `KLEVER_NODE_URL` se omitida) |
| `KLEVER_CHAIN_ID` | — | chain id ao usar URLs customizadas |
| `CONTRACT_ADDRESS` | — | endereço `klv1…` do TokenFactory deployado |
| `WALLET_PEM_PATH` | — | arquivo PEM (formato Klever) da conta que assina as transações |
| `WALLET_PEM_PASSWORD` | — | senha do PEM, só se ele foi gerado criptografado |
| `ABI_PATH` | `../token-factory/output/token-factory.abi.json` | ABI gerado pelo build |
| `WASM_PATH` | `../token-factory/output/token-factory.wasm` | bytecode, só para o deploy |
| `WAIT_FOR_TX` | `true` | esperar a confirmação on-chain antes de responder |

---

## API

Todas as quantidades trafegam como **string em unidades mínimas**, para não
perder precisão em `bigint`. Com `precision: 6`, `"1000000"` = 1 token.

Endpoints de escrita aceitam `"wait": true|false` no corpo, sobrepondo
`WAIT_FOR_TX`. Com `wait: false` a resposta volta logo após o broadcast, com o
hash — o resultado do contrato ainda não é conhecido.

### Leitura

| Método | Rota | Contrato |
|---|---|---|
| `GET` | `/health` | — |
| `GET` | `/api/contract` | `isPaused` + `getTotalIssued` + dados de rede (`configured: false` sem contrato) |
| `POST` | `/api/contract/deploy` | deploy do TokenFactory pela carteira do backend; `409` se já há contrato |
| `GET` | `/api/contract/paused` | `isPaused` |
| `GET` | `/api/contract/total-issued` | `getTotalIssued` |
| `GET` | `/api/contract/signer` | saldo/nonce da carteira do backend |
| `GET` | `/api/tokens?creator=klv1…&offset=0&limit=20` | `getTokensByCreator` + `getCreatorTokenCount` |
| `GET` | `/api/tokens/:tokenId` | `getTokenCreator` + dados do ativo no indexer (`/v1.0/assets/:id`) |
| `GET` | `/api/tx/:hash` | status + eventos decodificados do contrato |

### Escrita

| Método | Rota | Contrato |
|---|---|---|
| `POST` | `/api/tokens` | `issue` |
| `POST` | `/api/tokens/:tokenId/mint` | `mintToken` |
| `POST` | `/api/tokens/burn` | `burnToken` |
| `POST` | `/api/tokens/:tokenId/transfer-ownership` | `transferTokenOwnership` |
| `POST` | `/api/admin/pause` | `pause` (`only_owner`) |
| `POST` | `/api/admin/unpause` | `unpause` (`only_owner`) |
| `POST` | `/api/admin/name` | `changeContractName` (`only_owner`) |

---

## Exemplos

### Emitir um token fungível

O nó rejeita nomes com espaço ou pontuação (`token name is not human readable`):
use só letras e dígitos em `name`.


```bash
curl -X POST http://localhost:3000/api/tokens \
  -H 'content-type: application/json' \
  -d '{
    "assetType": "Fungible",
    "name": "DemoToken",
    "ticker": "DEMO",
    "precision": 6,
    "initialSupply": "1000000000",
    "maxSupply": "10000000000"
  }'
```

```jsonc
{
  "hash": "a1b2…",
  "status": "success",
  "explorerUrl": "https://testnet.kleverscan.org/transaction/a1b2…",
  "tokenId": "DEMO-4A2B",         // lido do recibo / evento tokenIssued
  "block": 1234567,
  "feeKLV": 20000000,
  "events": [
    { "identifier": "tokenIssued", "decodedTopics": ["…", "DEMO-4A2B", "…"] }
  ],
  "assetType": "Fungible",
  "request": { "name": "DemoToken", "ticker": "DEMO", "precision": 6, "…": "…" }
}
```

`assetType` aceita `0|1|2` ou `"Fungible" | "NFT" | "SemiFungible"` (`"SFT"` também).
Para NFT/SFT o contrato ignora `initialSupply` e `maxSupply` — e para NFT também a precisão.

### Mintar mais supply

```bash
curl -X POST http://localhost:3000/api/tokens/DEMO-4A2B/mint \
  -H 'content-type: application/json' \
  -d '{ "nonce": 0, "amount": "500000000" }'
```

`nonce` é `0` para fungível; para SFT, o nonce da instância.

### Queimar

```bash
curl -X POST http://localhost:3000/api/tokens/burn \
  -H 'content-type: application/json' \
  -d '{ "tokenId": "DEMO-4A2B", "nonce": 0, "amount": "100000000" }'
```

O `tokenId` vai no corpo e não na URL porque `burnToken` é `#[payable("*")]` e
**não recebe argumentos**: os tokens viajam como `callValue` da chamada, e o
contrato lê o pagamento recebido. No SDK isso vira:

```ts
contract.invoke('burnToken', { value: { 'DEMO-4A2B': 100000000n } })
```

### Listar tokens de um criador

```bash
curl "http://localhost:3000/api/tokens?creator=klv1…&offset=0&limit=20"
```

```json
{ "creator": "klv1…", "total": 3, "offset": 0, "limit": 20, "tokens": ["DEMO-4A2B", "…"] }
```

A paginação roda dentro do contrato (`getTokensByCreator(creator, offset, limit)`),
o backend só repassa. `total` vem de `getCreatorTokenCount`.

### Transferir a propriedade do ativo (irreversível)

```bash
curl -X POST http://localhost:3000/api/tokens/DEMO-4A2B/transfer-ownership \
  -H 'content-type: application/json' \
  -d '{ "newOwner": "klv1…" }'
```

Depois disso o contrato perde o controle do token: mint e burn param de funcionar
e `GET /api/tokens/DEMO-4A2B` passa a responder `404` (o registro é limpo).

---

## Erros

Reverts do contrato viram `400` com a mensagem original do `require!`:

```json
{ "error": "Caller is not the token creator" }
```

O nó aceita o broadcast **antes** de executar o contrato, então um `require!` que
falhou só aparece na transação minerada. É por isso que `settle()`
(`src/services/token-factory.ts`) inspeciona o evento `signalError` dos logs
depois do `wait()` — com `wait: false` a resposta volta com `status: "pending"` e
o erro não é detectado pelo backend.

| Status | Quando |
|---|---|
| `400` | validação de entrada ou revert do contrato |
| `404` | token não emitido por este contrato, ou transação inexistente |
| `409` | deploy pedido com `CONTRACT_ADDRESS` já configurado |
| `502` | nenhum TokenFactory respondeu em `CONTRACT_ADDRESS` |
| `503` | modo somente-leitura (sem `WALLET_PEM_PATH`) ou contrato não configurado |

---

## Estrutura

```
backend/
├── src/
│   ├── config.ts                  # .env validado com zod
│   ├── klever.ts                  # provider + wallet + Contract (klever-connect)
│   ├── app.ts                     # Express, rotas, error handler
│   ├── server.ts                  # bootstrap
│   ├── services/token-factory.ts  # camada tipada sobre o contrato
│   ├── services/assets.ts         # dados do KDA via indexer da Klever
│   ├── routes/                    # contract | tokens | admin | transactions
│   └── lib/                       # schemas zod, erros, decode de logs, paths
├── public/                        # frontend estático (index.html, app.js, style.css)
└── scripts/
    ├── deploy.ts                  # chama services/deploy.ts pelo terminal
    ├── demo.ts                    # fluxo ponta a ponta (fungível)
    ├── demo-sft.ts                # fluxo ponta a ponta (SFT)
    └── new-wallet.ts              # gera carteira de teste (wallet.pem)
```

## Notas de integração

- **`bytes` no ABI precisa de `Uint8Array`.** `name` e `ticker` são `bytes`, não
  `TokenIdentifier`, então o SDK não converte string sozinho — o serviço codifica
  em UTF-8 antes de passar (`utf8()` em `src/services/token-factory.ts`).
- **`variadic<T>` volta desembrulhado.** Com um único item, `call()` devolve o
  valor solto em vez de uma lista; `toArray()` normaliza.
- **Storage vazio não é erro.** `getTokenCreator` de um token desconhecido volta
  como string vazia, e não como exceção — daí o `null` explícito no serviço.
- **`ITransactionResponse` e `TransactionSubmitResult`** não são reexportados por
  `@klever/connect`; vêm de `@klever/connect-provider`.
- **`bigint` não serializa em JSON.** `jsonSafe()` (`src/lib/http.ts`) converte
  para string antes da resposta.
