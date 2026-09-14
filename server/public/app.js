/* Frontend básico do TokenFactory: fala só com o backend em /api. */

const $ = (id) => document.getElementById(id)

const state = {
  info: null, // GET /api/contract
  kind: 'sft', // 'fungible' | 'nft' | 'sft' do token selecionado
  creator: '',
  offset: 0,
  limit: 20,
  total: 0,
  token: null, // GET /api/tokens/:id
}

// ─── Utilidades ─────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error ?? `HTTP ${res.status}`)
    err.details = body.details
    err.status = res.status
    throw err
  }
  return body
}

const post = (path, data) => api(path, { method: 'POST', body: JSON.stringify(data ?? {}) })

/** "1.5" com precision 6 → "1500000" (BigInt, sem float). */
function toUnits(value, precision) {
  const text = String(value ?? '').trim().replace(',', '.')
  if (!text) return 0n
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Quantidade inválida: "${value}"`)
  const [whole, frac = ''] = text.split('.')
  if (frac.length > precision) throw new Error(`No máximo ${precision} casas decimais`)
  return BigInt(whole + frac.padEnd(precision, '0'))
}

/** "1500000" com precision 6 → "1.5". */
function fromUnits(value, precision) {
  const s = BigInt(value ?? 0).toString().padStart(precision + 1, '0')
  const whole = s.slice(0, s.length - precision)
  const frac = s.slice(s.length - precision).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

const short = (addr) => (addr && addr.length > 20 ? `${addr.slice(0, 10)}…${addr.slice(-6)}` : addr ?? '')

let toastTimer
function toast(message, kind = '') {
  const el = $('toast')
  el.textContent = message
  el.className = `toast ${kind}`
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (el.hidden = true), 4500)
}

/** Executa uma ação de escrita com feedback, bloqueando botões enquanto roda. */
async function run(title, fn) {
  document.body.classList.add('busy')
  document.querySelectorAll('button').forEach((b) => (b.disabled = true))
  const entry = logStart(title)
  try {
    const result = await fn()
    logDone(entry, result)
    toast(`${title}: ${result.status ?? 'ok'}`, 'ok')
    return result
  } catch (err) {
    logError(entry, err)
    toast(`${title}: ${err.message}`, 'error')
    throw err
  } finally {
    document.body.classList.remove('busy')
    document.querySelectorAll('button').forEach((b) => (b.disabled = false))
    updatePager()
  }
}

// ─── Atividade ──────────────────────────────────────────────────────────────

function logStart(title) {
  const list = $('activity')
  if (list.firstElementChild?.classList.contains('muted')) list.innerHTML = ''
  const li = document.createElement('li')
  li.innerHTML = `<div class="head"><span class="title"></span><span class="pill">enviando…</span><span class="time"></span></div>`
  li.querySelector('.title').textContent = title
  li.querySelector('.time').textContent = new Date().toLocaleTimeString()
  list.prepend(li)
  return li
}

function logDone(li, result) {
  const pill = li.querySelector('.pill')
  pill.textContent = result.status ?? 'ok'
  pill.className = `pill ${result.status === 'success' ? 'ok' : 'warn'}`
  if (result.explorerUrl) {
    const a = document.createElement('a')
    a.href = result.explorerUrl
    a.target = '_blank'
    a.rel = 'noopener'
    a.className = 'small'
    a.textContent = `tx ${result.hash?.slice(0, 12)}… ↗`
    li.querySelector('.head').insertBefore(a, li.querySelector('.time'))
  }
  const events = (result.events ?? [])
    .filter((e) => !['ReturnData', 'totalConsumedGas', 'completedTxEvent'].includes(e.identifier))
    .map((e) => `${e.identifier}(${e.decodedTopics.filter(Boolean).join(', ')})`)
  if (result.tokenId) events.unshift(`token: ${result.tokenId}`)
  if (events.length) {
    const div = document.createElement('div')
    div.className = 'events'
    div.textContent = events.join('  ·  ')
    li.append(div)
  }
}

function logError(li, err) {
  const pill = li.querySelector('.pill')
  pill.textContent = err.status ? `erro ${err.status}` : 'erro'
  pill.className = 'pill bad'
  const div = document.createElement('div')
  div.className = 'err'
  div.textContent = err.message
  li.append(div)
  if (err.details && typeof err.details === 'object' && !err.details.raw) {
    const pre = document.createElement('pre')
    pre.textContent = JSON.stringify(err.details, null, 1)
    li.append(pre)
  }
}

// ─── Contrato ───────────────────────────────────────────────────────────────

async function loadContract() {
  const info = await api('/api/contract')
  state.info = info

  const line = $('contract-line')
  line.innerHTML = ''
  if (info.configured) {
    const a = document.createElement('a')
    a.href = info.explorerUrl
    a.target = '_blank'
    a.rel = 'noopener'
    a.textContent = info.address
    line.append(a, ` · ${info.totalIssued} emitido(s)`)
  } else {
    line.textContent = 'contrato não configurado'
  }
  renderDeployCard(info)

  const net = $('pill-network')
  net.textContent = `${info.network.name} · chain ${info.network.chainId}`

  const mode = $('pill-mode')
  mode.textContent = info.signer ? `signer ${short(info.signer.address)}` : 'somente leitura'
  mode.className = `pill ${info.signer ? 'ok' : 'warn'}`
  mode.title = info.signer?.address ?? 'Configure WALLET_PEM_PATH para assinar'

  const paused = $('pill-paused')
  if (info.configured) {
    paused.textContent = info.paused ? 'pausado' : 'ativo'
    paused.className = `pill ${info.paused ? 'bad' : 'ok'}`
  } else {
    paused.textContent = 'sem contrato'
    paused.className = 'pill warn'
  }

  if (!state.creator && info.signer) {
    state.creator = info.signer.address
    $('list-creator').value = state.creator
  }
  return info
}

/** Mostra o card de deploy (e desativa o resto) enquanto não há contrato. */
function renderDeployCard(info) {
  const card = $('card-deploy')
  card.hidden = info.configured
  document.querySelector('main.layout').classList.toggle('unconfigured', !info.configured)
  if (info.configured) return

  const btn = $('btn-deploy')
  const hint = $('deploy-hint')
  btn.disabled = !info.canDeploy
  if (!info.signer) hint.textContent = 'Configure WALLET_PEM_PATH no .env: o deploy precisa de uma carteira para assinar.'
  else if (!info.wasmAvailable) hint.textContent = 'Wasm não encontrado: rode o build do contrato (ksc all build) ou ajuste WASM_PATH.'
  else hint.textContent = `Deployer: ${short(info.signer.address)} · rede ${info.network.name}. Custa a taxa de deploy em KLV.`
}

// ─── Lista ──────────────────────────────────────────────────────────────────

async function loadTokens() {
  const creator = $('list-creator').value.trim()
  if (!creator) return toast('Informe o endereço do criador', 'error')
  if (creator !== state.creator) state.offset = 0
  state.creator = creator

  const q = new URLSearchParams({ creator, offset: state.offset, limit: state.limit })
  const data = await api(`/api/tokens?${q}`)
  state.total = data.total

  const list = $('token-list')
  list.innerHTML = ''
  if (!data.tokens.length) {
    list.innerHTML = '<li class="muted">Nenhum token deste criador.</li>'
  }
  for (const id of data.tokens) {
    const li = document.createElement('li')
    li.textContent = id
    li.dataset.id = id
    if (state.token?.tokenId === id) li.classList.add('active')
    li.addEventListener('click', () => loadToken(id))
    list.append(li)
  }
  $('list-count').textContent = `${data.total} no total · ${state.offset + 1}–${state.offset + data.tokens.length}`
  updatePager()
}

function updatePager() {
  $('btn-prev').disabled = state.offset === 0
  $('btn-next').disabled = state.offset + state.limit >= state.total
}

// ─── Token ──────────────────────────────────────────────────────────────────

async function loadToken(id) {
  $('token-lookup').value = id
  let data
  try {
    data = await api(`/api/tokens/${encodeURIComponent(id)}`)
  } catch (err) {
    toast(err.message, 'error')
    return
  }
  state.token = data

  document.querySelectorAll('#token-list li').forEach((li) => li.classList.toggle('active', li.dataset.id === id))
  $('token-title').textContent = data.tokenId
  const ex = $('token-explorer')
  ex.href = data.explorerUrl
  ex.hidden = false
  $('token-empty').hidden = true
  $('token-details').hidden = false

  const a = data.asset
  const p = a?.precision ?? 0

  // Campos de mint/burn dependem do tipo do ativo:
  //  - fungível: só quantidade.
  //  - NFT: mint recebe só quantidade (a chain gera os nonces); burn recebe só o nonce,
  //    já que cada NFT é único e a quantidade é sempre 1.
  //  - SFT: quantidade + nonce nos dois (qual edição mintar/queimar).
  state.kind = tokenKind(a)
  const isSft = state.kind === 'sft'
  const isNft = state.kind === 'nft'
  const toggle = (id, show, { reset } = {}) => {
    const el = $(id)
    el.hidden = !show
    el.required = show
    if (!show && reset !== undefined) el.value = reset
  }
  toggle('mint-nonce', isSft, { reset: '0' })
  toggle('burn-amount', !isNft, { reset: '' })
  toggle('burn-nonce', isSft || isNft, { reset: '0' })
  $('mint-amount').placeholder = isNft ? `quantidade (máx ${MAX_NFT_MINT_BATCH} por tx)` : 'quantidade (ex: 100)'

  const fields = [
    ['Nome', a?.name ?? '—'],
    ['Tipo', a?.assetType ?? '—'],
    ['Precisão', a ? String(p) : '—'],
    ['Criador (contrato)', data.creator ?? 'não registrado (propriedade transferida?)', 'mono'],
    ['Dono on-chain', a?.ownerAddress ?? '—', 'mono'],
    ['Supply circulante', a ? fromUnits(a.circulatingSupply, p) : '—'],
    ['Supply inicial', a ? fromUnits(a.initialSupply, p) : '—'],
    ['Supply máximo', a ? (a.maxSupply === '0' ? 'ilimitado' : fromUnits(a.maxSupply, p)) : '—'],
    ['Mintado / queimado', a ? `${fromUnits(a.mintedValue, p)} / ${fromUnits(a.burnedValue, p)}` : '—'],
    ['Emitido em', a?.issueDate ? new Date(a.issueDate * 1000).toLocaleString() : '—'],
  ]
  const dl = $('token-fields')
  dl.innerHTML = ''
  for (const [k, v, cls] of fields) {
    const dt = document.createElement('dt')
    dt.textContent = k
    const dd = document.createElement('dd')
    dd.textContent = v
    if (cls) dd.className = cls
    dl.append(dt, dd)
  }
  if (a?.properties) {
    const dt = document.createElement('dt')
    dt.textContent = 'Propriedades'
    const dd = document.createElement('dd')
    dd.className = 'props'
    for (const [k, v] of Object.entries(a.properties)) {
      const s = document.createElement('span')
      s.className = `pill ${v ? 'ok' : ''}`
      s.textContent = k
      dd.append(s)
    }
    dl.append(dt, dd)
  }

  const managed = data.managedByContract
  ;['form-mint', 'form-burn', 'form-transfer'].forEach((f) => {
    $(f).querySelector('button').disabled = !managed || !state.info?.signer
  })
}

const precisionOfCurrent = () => state.token?.asset?.precision ?? 0

/** Parâmetro de rede `MaxNFTMintBatch`: NFTs por transação de mint (50 na testnet/mainnet). */
const MAX_NFT_MINT_BATCH = 50

/** 'fungible' | 'nft' | 'sft'. Sem dados do ativo assume SFT, o caso que mostra todos os campos. */
function tokenKind(asset) {
  const type = asset?.assetType ?? ''
  if (/^fungible$/i.test(type)) return 'fungible'
  if (/semi/i.test(type)) return 'sft'
  if (/nft|nonfungible/i.test(type)) return 'nft'
  return 'sft'
}

async function refreshAfterWrite() {
  await loadContract()
  if (state.creator) await loadTokens().catch(() => {})
  if (state.token) await loadToken(state.token.tokenId)
}

// ─── Eventos de UI ──────────────────────────────────────────────────────────

$('form-list').addEventListener('submit', (e) => {
  e.preventDefault()
  state.offset = 0
  loadTokens().catch((err) => toast(err.message, 'error'))
})
$('btn-prev').addEventListener('click', () => {
  state.offset = Math.max(0, state.offset - state.limit)
  loadTokens().catch((err) => toast(err.message, 'error'))
})
$('btn-next').addEventListener('click', () => {
  state.offset += state.limit
  loadTokens().catch((err) => toast(err.message, 'error'))
})

$('btn-lookup').addEventListener('click', () => {
  const id = $('token-lookup').value.trim().toUpperCase()
  if (id) loadToken(id)
})
$('token-lookup').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    $('btn-lookup').click()
  }
})

$('form-issue').addEventListener('submit', async (e) => {
  e.preventDefault()
  const precision = Number($('issue-precision').value)
  let body
  try {
    body = {
      assetType: $('issue-type').value,
      name: $('issue-name').value.trim(),
      ticker: $('issue-ticker').value.trim().toUpperCase(),
      precision,
      initialSupply: toUnits($('issue-initial').value, precision).toString(),
      maxSupply: toUnits($('issue-max').value, precision).toString(),
    }
  } catch (err) {
    return toast(err.message, 'error')
  }
  const result = await run(`Emitir ${body.ticker}`, () => post('/api/tokens', body)).catch(() => null)
  if (!result) return
  $('form-issue').reset()
  $('issue-precision').value = '6'
  await refreshAfterWrite()
  if (result.tokenId) await loadToken(result.tokenId)
})

$('form-mint').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = state.token.tokenId
  let amount
  try {
    amount = toUnits($('mint-amount').value, precisionOfCurrent())
  } catch (err) {
    return toast(err.message, 'error')
  }
  if (state.kind === 'nft' && amount > BigInt(MAX_NFT_MINT_BATCH)) {
    return toast(`A rede limita o mint a ${MAX_NFT_MINT_BATCH} NFTs por transação`, 'error')
  }
  const body = { amount: amount.toString(), nonce: Number($('mint-nonce').value || 0) }
  const ok = await run(`Mint ${$('mint-amount').value} ${id}`, () =>
    post(`/api/tokens/${encodeURIComponent(id)}/mint`, body),
  ).catch(() => null)
  if (ok) {
    $('mint-amount').value = ''
    await refreshAfterWrite()
  }
})

$('form-burn').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = state.token.tokenId
  const isNft = state.kind === 'nft'
  const nonce = Number($('burn-nonce').value || 0)
  if (isNft && nonce <= 0) return toast('Informe o nonce do NFT a queimar', 'error')
  let amount
  try {
    // NFT é único: queima sempre 1 unidade do nonce informado.
    amount = isNft ? 1n : toUnits($('burn-amount').value, precisionOfCurrent())
  } catch (err) {
    return toast(err.message, 'error')
  }
  const body = { tokenId: id, amount: amount.toString(), nonce }
  const label = isNft ? `Burn ${id}/${nonce}` : `Burn ${$('burn-amount').value} ${id}`
  const ok = await run(label, () => post('/api/tokens/burn', body)).catch(() => null)
  if (ok) {
    $('burn-amount').value = ''
    if (isNft) $('burn-nonce').value = '0'
    await refreshAfterWrite()
  }
})

$('form-transfer').addEventListener('submit', async (e) => {
  e.preventDefault()
  const id = state.token.tokenId
  const newOwner = $('transfer-owner').value.trim()
  if (!window.confirm(`Transferir a propriedade de ${id} para\n${newOwner}?\n\nIsso é irreversível.`)) return
  const ok = await run(`Transferir ${id}`, () =>
    post(`/api/tokens/${encodeURIComponent(id)}/transfer-ownership`, { newOwner }),
  ).catch(() => null)
  if (ok) {
    $('transfer-owner').value = ''
    await refreshAfterWrite()
  }
})

$('btn-deploy').addEventListener('click', async () => {
  const ok = await run('Deploy do TokenFactory', () => post('/api/contract/deploy')).catch(() => null)
  if (!ok) return
  toast(ok.persisted ? `Contrato ${short(ok.address)} gravado no .env` : `Contrato ${ok.address} (não gravado no .env)`, ok.persisted ? 'ok' : 'error')
  await loadContract()
  if (state.creator) await loadTokens().catch(() => {})
})

$('btn-pause').addEventListener('click', async () => {
  const ok = await run('Pausar contrato', () => post('/api/admin/pause')).catch(() => null)
  if (ok) await loadContract()
})
$('btn-unpause').addEventListener('click', async () => {
  const ok = await run('Despausar contrato', () => post('/api/admin/unpause')).catch(() => null)
  if (ok) await loadContract()
})
$('form-name').addEventListener('submit', async (e) => {
  e.preventDefault()
  const name = $('admin-name').value.trim()
  const ok = await run(`Renomear contrato`, () => post('/api/admin/name', { name })).catch(() => null)
  if (ok) $('admin-name').value = ''
})

$('btn-clear').addEventListener('click', () => {
  $('activity').innerHTML = '<li class="muted">Nenhuma transação ainda.</li>'
})

// ─── Boot ───────────────────────────────────────────────────────────────────

;(async () => {
  try {
    const info = await loadContract()
    if (info.configured && state.creator) await loadTokens()
  } catch (err) {
    toast(`Backend indisponível: ${err.message}`, 'error')
  }
})()
