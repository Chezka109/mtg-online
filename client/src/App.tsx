import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameAction, GameMode, GameState, Phase } from '@mtg-online/shared'
import './App.css'
import { createMtgSocket, type MtgSocket } from './lib/socket'
import { parseArenaDeck } from './lib/arenaDeck'

const LS_PLAYER_ID = 'mtg-online.playerId'

const CARD_H = 134

function getServerUrl(): string {
  return (import.meta as any).env?.VITE_SERVER_URL ?? 'http://localhost:3001'
}

function App() {
  const [socket, setSocket] = useState<MtgSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [playerName, setPlayerName] = useState('')
  const [gameMode, setGameMode] = useState<GameMode>('standard')
  const [joinCode, setJoinCode] = useState('')
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [state, setState] = useState<GameState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [chatText, setChatText] = useState('')
  const [deckText, setDeckText] = useState('')
  const [attachFrom, setAttachFrom] = useState<string | null>(null)

  const [previewCardId, setPreviewCardId] = useState<string | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [battlefieldDragOver, setBattlefieldDragOver] = useState(false)

  const [diceRolling, setDiceRolling] = useState(false)
  const [diceTemp, setDiceTemp] = useState(1)
  const [diceOverlay, setDiceOverlay] = useState<{ by: string; value: number } | null>(null)
  const lastLogEntryRef = useRef<string | null>(null)

  const [phaseOverlay, setPhaseOverlay] = useState<string | null>(null)
  const lastPhaseRef = useRef<Phase | null>(null)

  const boardViewportRef = useRef<HTMLDivElement | null>(null)
  const ignoreNextTapRef = useRef<string | null>(null)
  const dragMovedRef = useRef(false)
  const [dragging, setDragging] = useState<
    | null
    | {
      cardId: string
      board: 'me'
      startClientX: number
      startClientY: number
      startX: number
      startY: number
    }
  >(null)
  const [dragOverride, setDragOverride] = useState<Record<string, { x: number; y: number }>>({})
  const dragOverrideRef = useRef<Record<string, { x: number; y: number }>>({})

  useEffect(() => {
    dragOverrideRef.current = dragOverride
  }, [dragOverride])

  const serverUrl = useMemo(() => getServerUrl(), [])

  useEffect(() => {
    const s = createMtgSocket(serverUrl)
    setSocket(s)
    setConnected(s.connected)

    s.on('connect', () => setConnected(true))
    s.on('disconnect', () => setConnected(false))
    s.on('connect_error', (err) => {
      setConnected(false)
      setToast(`ERROR: ${err.message}`)
      window.setTimeout(() => setToast(null), 3000)
    })

    s.on('state:full', ({ state }) => setState(state))
    s.on('state:patch', ({ state }) => setState(state))
    s.on('system:toast', ({ message, kind }) => {
      setToast(`${kind.toUpperCase()}: ${message}`)
      window.setTimeout(() => setToast(null), 3000)
    })

    return () => {
      s.disconnect()
      setSocket(null)
      setConnected(false)
    }
  }, [serverUrl])

  function myPlayer() {
    if (!state || !playerId) return null
    return state.players[playerId] ?? null
  }

  function sendAction(action: GameAction) {
    socket?.emit('game:action', action)
  }

  async function copyRoom() {
    if (!roomCode) return
    await navigator.clipboard.writeText(roomCode)
    setToast('INFO: Copied room code')
    window.setTimeout(() => setToast(null), 2000)
  }

  function onCreateRoom() {
    if (!socket || !connected) return setToast('ERROR: Not connected to server')
    const name = playerName.trim()
    if (!name) return setToast('ERROR: Enter your name')
    socket.emit('room:create', { playerName: name, gameMode }, (res) => {
      if (!res.ok) return setToast(`ERROR: ${res.error}`)
      setRoomCode(res.roomCode)
      setPlayerId(res.playerId)
      localStorage.setItem(LS_PLAYER_ID, res.playerId)
      setState(res.state)
    })
  }

  function onJoinRoom() {
    if (!socket || !connected) return setToast('ERROR: Not connected to server')
    const name = playerName.trim()
    if (!name) return setToast('ERROR: Enter your name')
    const code = joinCode.trim().toUpperCase()
    if (!code) return setToast('ERROR: Enter a room code')
    const existingPid = localStorage.getItem(LS_PLAYER_ID) ?? undefined
    socket.emit(
      'room:join',
      { roomCode: code, playerName: name, playerId: existingPid },
      (res) => {
        if (!res.ok) return setToast(`ERROR: ${res.error}`)
        setRoomCode(res.roomCode)
        setPlayerId(res.playerId)
        localStorage.setItem(LS_PLAYER_ID, res.playerId)
        setState(res.state)
      },
    )
  }

  function onSendChat() {
    const text = chatText.trim()
    if (!text) return
    socket?.emit('chat:send', { text })
    setChatText('')
  }

  function onImportDeck() {
    const parsed = parseArenaDeck(deckText)
    if (!parsed.ok) return setToast(`ERROR: ${parsed.error}`)
    socket?.emit('deck:importArena', { deck: parsed.deck }, (res) => {
      if (!res.ok) return setToast(`ERROR: ${res.error}`)
      setToast('INFO: Deck imported')
      window.setTimeout(() => setToast(null), 2000)
    })
  }

  useEffect(() => {
    if (!state) return

    // Dice overlay driven by authoritative log entries so both players see it.
    const newest = state.log[state.log.length - 1] ?? null
    if (newest && newest !== lastLogEntryRef.current) {
      lastLogEntryRef.current = newest
      const m = newest.match(/^(.*) rolled d20: (\d{1,2})$/)
      if (m) {
        const by = m[1] || 'Player'
        const value = Math.max(1, Math.min(20, Number(m[2])))
        setDiceRolling(false)
        setDiceOverlay({ by, value })
        window.setTimeout(() => setDiceOverlay(null), 1600)
      }
    }
  }, [state])

  useEffect(() => {
    if (!state?.turn?.phase) return
    const phase = state.turn.phase
    if (lastPhaseRef.current === null) {
      lastPhaseRef.current = phase
      return
    }
    if (lastPhaseRef.current !== phase) {
      lastPhaseRef.current = phase
      setPhaseOverlay(phase)
      window.setTimeout(() => setPhaseOverlay(null), 1300)
    }
  }, [state?.turn?.phase])

  const me = myPlayer()

  const players = useMemo(() => {
    if (!state) return []
    return Object.values(state.players)
  }, [state])

  const opponentHandCount = useMemo(() => {
    if (!state || !playerId) return 0
    return Object.values(state.players)
      .filter((p) => p.id !== playerId)
      .reduce((sum, p) => sum + p.hand.length, 0)
  }, [state, playerId])

  const allBattlefield = useMemo(() => {
    if (!state) return [] as Array<{ cardId: string; ownerId: string }>
    const out: Array<{ cardId: string; ownerId: string }> = []
    for (const p of Object.values(state.players)) {
      for (const cid of p.battlefield) out.push({ cardId: cid, ownerId: p.id })
    }
    return out
  }, [state])

  const previewCard = previewCardId && state ? state.cards[previewCardId] : null
  const selectedCard = selectedCardId && state ? state.cards[selectedCardId] : null

  function shuffleIntoLibrary(cardId: string) {
    if (!state || !playerId) return
    const c = state.cards[cardId]
    if (!c) return
    // Only shuffle your own library (server blocks other playerId-scoped actions).
    if (c.ownerId !== playerId) return
    sendAction({ type: 'moveCard', cardId, toZone: 'library' })
    sendAction({ type: 'shuffleLibrary', playerId })
  }

  function onRollD20() {
    if (!playerId) return
    setDiceOverlay(null)
    setDiceRolling(true)
    const startedAt = Date.now()
    const interval = window.setInterval(() => setDiceTemp(1 + Math.floor(Math.random() * 20)), 60)
    window.setTimeout(() => {
      window.clearInterval(interval)
      // If no log-driven result showed up, stop rolling anyway.
      if (Date.now() - startedAt > 600) setDiceRolling(false)
    }, 900)
    sendAction({ type: 'dice:rollD20', playerId })
  }

  function onAnnouncePhase(phase: Phase) {
    if (!playerId) return
    sendAction({ type: 'turn:setPhase', playerId, phase })
  }

  function onNextPhase() {
    if (!playerId) return
    sendAction({ type: 'turn:nextPhase', playerId })
  }

  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n))
  }

  function defaultBattlefieldPos(index: number) {
    const cols = 10
    const gapX = 16
    const gapY = 18
    const cellW = 134 + gapX
    const cellH = 134 + gapY
    return { x: 12 + (index % cols) * cellW, y: 12 + Math.floor(index / cols) * cellH }
  }

  function getRenderedPos(cardId: string, fallbackIndex: number) {
    if (dragOverride[cardId]) return dragOverride[cardId]
    const c = state?.cards[cardId]
    if (c?.battlefieldPos) return c.battlefieldPos
    return defaultBattlefieldPos(fallbackIndex)
  }

  function beginDrag(cardId: string, startClientX: number, startClientY: number, startX: number, startY: number) {
    dragMovedRef.current = false
    setDragging({ cardId, board: 'me', startClientX, startClientY, startX, startY })
    setDragOverride((prev) => ({ ...prev, [cardId]: { x: startX, y: startY } }))
  }

  useEffect(() => {
    if (!dragging) return
    const d = dragging

    function onMove(e: PointerEvent) {
      const dx = e.clientX - d.startClientX
      const dy = e.clientY - d.startClientY
      if (!dragMovedRef.current && Math.abs(dx) + Math.abs(dy) > 3) dragMovedRef.current = true
      setDragOverride((prev) => ({
        ...prev,
        [d.cardId]: { x: d.startX + dx, y: d.startY + dy },
      }))
    }

    function onUp() {
      const p = dragOverrideRef.current[d.cardId] ?? { x: d.startX, y: d.startY }
      const x = clamp(p.x, -500, 5000)
      const y = clamp(p.y, -500, 5000)
      sendAction({ type: 'card:setPos', cardId: d.cardId, x, y })

      if (dragMovedRef.current) ignoreNextTapRef.current = d.cardId

      setDragOverride((prev) => {
        const next = { ...prev }
        delete next[d.cardId]
        return next
      })
      setDragging(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging])

  if (!roomCode || !state || !playerId) {
    return (
      <div className="page">
        <header className="header">
          <h1>MTG Online</h1>
          <div className="muted">Server: {serverUrl}</div>
        </header>

        <div className="panel">
          <label>
            Your name
            <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="e.g. Chezka" />
          </label>

          <div className="row">
            <label>
              Game mode
              <select value={gameMode} onChange={(e) => setGameMode(e.target.value as GameMode)}>
                <option value="standard">Standard</option>
                <option value="pioneer">Pioneer</option>
                <option value="modern">Modern</option>
                <option value="legacy">Legacy</option>
                <option value="vintage">Vintage</option>
                <option value="commander">Commander</option>
                <option value="brawl">Brawl</option>
                <option value="custom">Custom</option>
              </select>
            </label>
          </div>

          <div className="row">
            <button onClick={onCreateRoom} disabled={!socket || !playerName.trim()}>
              Create room
            </button>
          </div>

          <div className="divider" />

          <label>
            Room code
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="e.g. 7H2KQ9" />
          </label>
          <div className="row">
            <button onClick={onJoinRoom} disabled={!socket || !playerName.trim() || !joinCode.trim()}>
              Join room
            </button>
          </div>

          {toast && <div className="toast">{toast}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="gamePage">
      {(diceRolling || diceOverlay) && (
        <div className="overlayCenter" aria-live="polite">
          <div className={`diceWidget ${diceRolling ? 'rolling' : ''}`}>
            <div className="diceTitle">d20</div>
            <div className="diceValue">{diceOverlay?.value ?? diceTemp}</div>
            {diceOverlay && <div className="diceBy">{diceOverlay.by}</div>}
          </div>
        </div>
      )}

      {phaseOverlay && (
        <div className="overlayTop" aria-live="polite">
          <div className="phaseWidget">{phaseOverlay.replaceAll('_', ' ')}</div>
        </div>
      )}

      {/* Fullscreen freeform battlefield */}
      <div
        className={`battlefieldRoot dropTarget ${battlefieldDragOver ? 'dragOver' : ''}`}
        ref={boardViewportRef}
        onDragOver={(e) => {
          e.preventDefault()
          setBattlefieldDragOver(true)
        }}
        onDragLeave={() => setBattlefieldDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setBattlefieldDragOver(false)
          const cid = e.dataTransfer.getData('text/plain')
          if (!cid) return

          const viewport = boardViewportRef.current
          const rect = viewport?.getBoundingClientRect()
          if (viewport && rect) {
            const x = e.clientX - rect.left + viewport.scrollLeft - CARD_H / 2
            const y = e.clientY - rect.top + viewport.scrollTop - CARD_H / 2
            sendAction({ type: 'card:setPos', cardId: cid, x, y })
          }
          sendAction({ type: 'moveCard', cardId: cid, toZone: 'battlefield' })
        }}
        onPointerDown={(e) => {
          // Click on empty board clears selection.
          if (e.target === e.currentTarget) setSelectedCardId(null)
        }}
      >
        <div className="boardSurface" onPointerDown={() => setSelectedCardId(null)}>
          {allBattlefield.map(({ cardId }, idx) => {
            const c = state.cards[cardId]
            if (!c) return null
            const pos = getRenderedPos(cardId, idx)
            const isSelected = selectedCardId === cardId
            return (
              <div
                key={cardId}
                className={`cardBattle ${c.tapped ? 'isTapped' : ''} ${isSelected ? 'isSelected' : ''}`}
                style={{ left: pos.x, top: pos.y }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  setSelectedCardId(cardId)
                  setPreviewCardId(cardId)
                }}
                onPointerUp={() => setPreviewCardId(null)}
              >
                <button
                  className="cardTap"
                  onDoubleClick={() => sendAction({ type: 'tapToggle', cardId })}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.stopPropagation()
                    e.currentTarget.setPointerCapture(e.pointerId)
                    beginDrag(cardId, e.clientX, e.clientY, pos.x, pos.y)
                  }}
                  title="Drag to move • Double-click to tap"
                >
                  {c.definition.imageUrl ? (
                    <img className="cardArt" src={c.definition.imageUrl} alt={c.definition.name} loading="lazy" draggable={false} />
                  ) : (
                    <div className="cardFallback">{c.definition.name}</div>
                  )}
                </button>

                {c.counters.length > 0 && (
                  <div className="cardBadges">
                    {c.counters.slice(0, 2).map((ct) => (
                      <div key={ct.id} className="badge">
                        {ct.kind}:{ct.amount}
                      </div>
                    ))}
                    {c.counters.length > 2 && <div className="badge">+{c.counters.length - 2}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Floating HUD: left */}
      <aside className="hudPanel hudLeft">
        <div className="hudTitleRow">
          <div>
            <div className="hudTitle">Room {roomCode}</div>
            <div className="muted">Mode: {state.gameMode}</div>
          </div>
          <button onClick={copyRoom}>Copy</button>
        </div>

        <div className="panel" style={{ padding: 10 }}>
          <div className="muted">Players</div>
          <div className="playersHud">
            {players.map((p) => (
              <div key={p.id} className="playerHudRow">
                <div className="playerName">{p.name}{p.id === playerId ? ' (You)' : ''}</div>
                <div className="row">
                  <button onClick={() => sendAction({ type: 'setLife', playerId: p.id, life: p.life - 1 })}>-</button>
                  <div className="life">{p.life}</div>
                  <button onClick={() => sendAction({ type: 'setLife', playerId: p.id, life: p.life + 1 })}>+</button>
                </div>
                <div className="muted">mull {p.mulligans ?? 0} • hand {p.hand.length}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel" style={{ padding: 10 }}>
          <div className="phaseRow">
            <div className="phaseLabel">Phase</div>
            <div className="phaseValue">{state.turn?.phase.replaceAll('_', ' ')}</div>
            <select value={state.turn?.phase} onChange={(e) => onAnnouncePhase(e.target.value as Phase)} aria-label="Set phase">
              <option value="beginning">Beginning</option>
              <option value="precombat_main">Precombat main</option>
              <option value="combat">Combat</option>
              <option value="postcombat_main">Postcombat main</option>
              <option value="ending">Ending</option>
            </select>
            <button onClick={onNextPhase}>Next</button>
          </div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button onClick={onRollD20}>Roll d20</button>
            <button onClick={() => sendAction({ type: 'shuffleLibrary', playerId })}>Shuffle</button>
            <button onClick={() => sendAction({ type: 'draw', playerId, count: 1 })}>Draw</button>
            <button onClick={() => sendAction({ type: 'draw', playerId, count: 7 })}>Draw 7</button>
            <button onClick={() => sendAction({ type: 'mulligan', playerId })}>Mulligan</button>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            Opponent hand: {opponentHandCount}
          </div>
        </div>
      </aside>

      {/* Floating HUD: right */}
      <aside className="hudPanel hudRight">
        <section className="panel">
          <h2>Preview</h2>
          {previewCard ? (
            <div className="previewBox">
              <div className="previewName">{previewCard.definition.name}</div>
              {previewCard.definition.imageUrl ? (
                <img className="previewImg" src={previewCard.definition.imageUrl} alt={previewCard.definition.name} />
              ) : (
                <div className="muted">No image yet</div>
              )}
            </div>
          ) : (
            <div className="muted">Hold a card to preview</div>
          )}
        </section>

        <section className="panel">
          <h2>Selected card</h2>
          {selectedCard ? (
            <div className="selectedCardBox">
              <div className="previewName">{selectedCard.definition.name}</div>
              <div className="muted">zone: {selectedCard.zone}</div>
              <div className="row wrap" style={{ marginTop: 8 }}>
                {selectedCard.zone === 'battlefield' && (
                  <button onClick={() => sendAction({ type: 'tapToggle', cardId: selectedCard.id })}>
                    {selectedCard.tapped ? 'Untap' : 'Attack (Tap)'}
                  </button>
                )}
                <button onClick={() => sendAction({ type: 'moveCard', cardId: selectedCard.id, toZone: 'hand' })}>To hand</button>
                <button onClick={() => sendAction({ type: 'moveCard', cardId: selectedCard.id, toZone: 'graveyard' })}>To GY</button>
                <button onClick={() => sendAction({ type: 'moveCard', cardId: selectedCard.id, toZone: 'exile' })}>Exile</button>
                <button onClick={() => sendAction({ type: 'moveCard', cardId: selectedCard.id, toZone: 'library' })}>To library</button>
                <button onClick={() => shuffleIntoLibrary(selectedCard.id)} disabled={selectedCard.ownerId !== playerId}>
                  Shuffle into deck
                </button>
                {selectedCard.zone !== 'battlefield' && (
                  <button onClick={() => sendAction({ type: 'moveCard', cardId: selectedCard.id, toZone: 'battlefield' })}>
                    To battlefield
                  </button>
                )}
              </div>

              <div className="divider" />

              <div className="row wrap">
                <button
                  onClick={() => {
                    const kind = window.prompt('Counter kind (e.g. +1/+1, loyalty):', '+1/+1')?.trim()
                    if (!kind) return
                    const amtRaw = window.prompt('Amount to add (default 1):', '1')?.trim()
                    const amount = amtRaw ? Number(amtRaw) : 1
                    if (!Number.isFinite(amount)) return
                    sendAction({ type: 'counter:add', cardId: selectedCard.id, kind, amount })
                  }}
                >
                  + Counter
                </button>
                <button onClick={() => sendAction({ type: 'counter:clear', cardId: selectedCard.id })}>Clear counters</button>
                {!attachFrom && <button onClick={() => setAttachFrom(selectedCard.id)}>Attach…</button>}
                {selectedCard.attachedTo && <button onClick={() => sendAction({ type: 'detach', attachmentCardId: selectedCard.id })}>Detach</button>}
              </div>

              {attachFrom && attachFrom !== selectedCard.id && (
                <div className="notice compact" style={{ marginTop: 10 }}>
                  Attach <b>{state.cards[attachFrom]?.definition.name ?? 'card'}</b> to <b>{selectedCard.definition.name}</b>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button
                      onClick={() => {
                        sendAction({ type: 'attach', attachmentCardId: attachFrom, targetCardId: selectedCard.id })
                        setAttachFrom(null)
                      }}
                    >
                      Attach
                    </button>
                    <button onClick={() => setAttachFrom(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="muted">Click a card on the battlefield</div>
          )}
        </section>

        <section className="panel">
          <h2>Deck import (Arena)</h2>
          <textarea value={deckText} onChange={(e) => setDeckText(e.target.value)} rows={6} placeholder="Paste MTG Arena deck list here" />
          <div className="row">
            <button onClick={onImportDeck}>Import</button>
            <button onClick={() => setDeckText('')}>Clear</button>
          </div>
          <div className="muted">Library: {me?.library.length ?? 0} • GY: {me?.graveyard.length ?? 0} • Exile: {me?.exile.length ?? 0}</div>
        </section>

        <section className="panel">
          <h2>Graveyard</h2>
          <div className="zoneList">
            {(me?.graveyard ?? []).slice().reverse().slice(0, 30).map((cid) => {
              const c = state.cards[cid]
              if (!c) return null
              return (
                <div key={cid} className="zoneRow" onPointerDown={() => setPreviewCardId(cid)} onPointerUp={() => setPreviewCardId(null)}>
                  {c.definition.imageUrl ? (
                    <img className="zoneThumb" src={c.definition.imageUrl} alt={c.definition.name} loading="lazy" />
                  ) : (
                    <div className="zoneThumbFallback" />
                  )}
                  <div className="zoneName" title={c.definition.name}>
                    {c.definition.name}
                  </div>
                  <div className="zoneActions">
                    <button onClick={() => sendAction({ type: 'moveCard', cardId: cid, toZone: 'hand' })}>Hand</button>
                    <button onClick={() => sendAction({ type: 'moveCard', cardId: cid, toZone: 'battlefield' })}>BF</button>
                    <button onClick={() => sendAction({ type: 'moveCard', cardId: cid, toZone: 'exile' })}>Ex</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel">
          <h2>Exile</h2>
          <div className="zoneList">
            {(me?.exile ?? []).slice().reverse().slice(0, 30).map((cid) => {
              const c = state.cards[cid]
              if (!c) return null
              return (
                <div key={cid} className="zoneRow" onPointerDown={() => setPreviewCardId(cid)} onPointerUp={() => setPreviewCardId(null)}>
                  {c.definition.imageUrl ? (
                    <img className="zoneThumb" src={c.definition.imageUrl} alt={c.definition.name} loading="lazy" />
                  ) : (
                    <div className="zoneThumbFallback" />
                  )}
                  <div className="zoneName" title={c.definition.name}>
                    {c.definition.name}
                  </div>
                  <div className="zoneActions">
                    <button onClick={() => sendAction({ type: 'moveCard', cardId: cid, toZone: 'hand' })}>Hand</button>
                    <button onClick={() => sendAction({ type: 'moveCard', cardId: cid, toZone: 'graveyard' })}>GY</button>
                    <button onClick={() => sendAction({ type: 'moveCard', cardId: cid, toZone: 'battlefield' })}>BF</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel">
          <h2>Chat</h2>
          <div className="chat">
            {state.chat.slice(-50).map((m) => (
              <div key={m.id} className="chatLine">
                <span className="muted">{state.players[m.playerId]?.name ?? 'Player'}:</span> {m.text}
              </div>
            ))}
          </div>
          <div className="row">
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              placeholder="message"
              onKeyDown={(e) => e.key === 'Enter' && onSendChat()}
            />
            <button onClick={onSendChat}>Send</button>
          </div>
        </section>

        <section className="panel">
          <h2>Game log</h2>
          <div className="log">
            {state.log.slice(-40).map((l, idx) => (
              <div key={idx} className="muted">{l}</div>
            ))}
          </div>
          {toast && <div className="toast">{toast}</div>}
        </section>
      </aside>

      {/* Bottom hand bar */}
      <div className="handDock" aria-label="Your hand">
        <div className="handMeta">
          <div className="muted">Your hand</div>
          <div className="handCount">{me?.hand.length ?? 0}</div>
        </div>
        <div className="handRow">
          {(me?.hand ?? []).map((cid) => {
            const c = state.cards[cid]
            if (!c) return null
            return (
              <div
                key={cid}
                className="cardMini"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', cid)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onPointerDown={() => {
                  setSelectedCardId(cid)
                  setPreviewCardId(cid)
                }}
                onPointerUp={() => setPreviewCardId(null)}
                title="Drag to battlefield"
              >
                {c.definition.imageUrl ? (
                  <img className="cardArtMini" src={c.definition.imageUrl} alt={c.definition.name} loading="lazy" />
                ) : (
                  <div className="cardFallback">{c.definition.name}</div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default App
