import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CardInstance, GameAction, GameMode, GameState, Phase, PlayerState } from '@mtg-online/shared'
import './App.css'
import { createMtgSocket, type MtgSocket } from './lib/socket'
import { parseArenaDeck } from './lib/arenaDeck'

const LS_PLAYER_ID = 'mtg-online.playerId'
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'
const PHASES: Array<{ value: Phase; label: string }> = [
  { value: 'beginning', label: 'Beginning' },
  { value: 'precombat_main', label: 'Precombat main' },
  { value: 'combat', label: 'Combat' },
  { value: 'postcombat_main', label: 'Postcombat main' },
  { value: 'ending', label: 'Ending' },
]
const CARD_TAGS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'white'] as const
const COUNTER_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'white', 'gray'] as const
const DICE = [4, 6, 8, 10, 12, 20, 100]
const BOARD_CATEGORIES = ['land', 'creature', 'artifact', 'enchantment', 'planeswalker', 'other'] as const
type BoardCategory = (typeof BOARD_CATEGORIES)[number]
type InspectableZone = 'library' | 'graveyard' | 'exile' | 'command' | 'sideboard'

const GLOSSARY = [
  ['Activated ability', 'An ability written as “cost: effect.” You choose when to activate it unless another rule says otherwise.'],
  ['Attach', 'Put an Aura, Equipment, or Fortification onto another object. This tabletop lets players attach any permanent for convenience.'],
  ['Combat', 'The turn phase where attackers and blockers are declared and combat damage is dealt.'],
  ['Commander', 'A legendary creature designated before the game that can be cast from the command zone.'],
  ['Counter', 'A marker that changes or tracks something on a card or player, such as +1/+1, loyalty, poison, or energy.'],
  ['Deathtouch', 'Any amount of damage from a source with deathtouch is lethal to a creature.'],
  ['Exile', 'A public zone where cards are kept apart from the battlefield and graveyard.'],
  ['First strike', 'This creature deals combat damage in an earlier combat-damage step.'],
  ['Flash', 'You may cast this spell any time you could cast an instant.'],
  ['Flying', 'This creature can be blocked only by creatures with flying or reach.'],
  ['Haste', 'This creature can attack and use tap abilities without waiting for your next turn.'],
  ['Hexproof', 'This permanent cannot be targeted by spells or abilities opponents control.'],
  ['Indestructible', 'Effects that say “destroy” and lethal damage do not destroy this permanent.'],
  ['Lifelink', 'Damage dealt by this source also causes its controller to gain that much life.'],
  ['Mulligan', 'Shuffle your hand into your library and draw a new opening hand; normal formats then require putting cards on the bottom.'],
  ['Priority', 'The opportunity to cast spells, activate abilities, or pass. This app intentionally does not enforce priority.'],
  ['Reach', 'This creature can block creatures with flying.'],
  ['Stack', 'Spells and abilities wait here to resolve in last-in, first-out order. The current tabletop handles this informally.'],
  ['Token', 'A game object represented by a marker rather than a card.'],
  ['Trample', 'Excess combat damage may be assigned to the defending player or planeswalker.'],
  ['Vigilance', 'Attacking does not cause this creature to tap.'],
  ['Zone', 'A game area such as library, hand, battlefield, graveyard, exile, command zone, or stack.'],
] as const

const RULES = [
  ['1. Set up', 'Import a deck, shuffle, draw an opening hand, and set the life total appropriate for your format.'],
  ['2. Turn flow', 'Move through Beginning, Precombat Main, Combat, Postcombat Main, and Ending. The active player controls the phase selector.'],
  ['3. Playing cards', 'Drag a card from your hand to your battlefield. Use the selected-card panel to move it elsewhere, attach it, or add counters.'],
  ['4. Communication', 'Announce targets, responses, triggers, and shortcuts in chat or voice. The app is a shared tabletop, not a strict rules judge.'],
  ['5. Flexible enforcement', 'Players may correct mistakes, rewind with mutual agreement, adjust any life total, and move cards manually between zones.'],
] as const

function cardCategory(card: CardInstance): BoardCategory {
  const type = card.definition.typeLine?.toLowerCase() ?? ''
  if (type.includes('land')) return 'land'
  if (type.includes('creature')) return 'creature'
  if (type.includes('planeswalker')) return 'planeswalker'
  if (type.includes('artifact')) return 'artifact'
  if (type.includes('enchantment')) return 'enchantment'
  return 'other'
}

function categoryLabel(category: BoardCategory) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function logIcon(line: string) {
  if (/rolled|flipped|randomized|random player/.test(line)) return '◇'
  if (/drew|mulligan|shuffled|deck/.test(line)) return '▤'
  if (/life/.test(line)) return '♥'
  if (/→/.test(line)) return '›'
  if (/joined|reconnected|created/.test(line)) return '●'
  return '·'
}

function App() {
  const [socket] = useState<MtgSocket>(() => createMtgSocket(SERVER_URL))
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
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [zoomedCardId, setZoomedCardId] = useState<string | null>(null)
  const [attachFrom, setAttachFrom] = useState<string | null>(null)
  const [layoutMode, setLayoutMode] = useState<'organized' | 'freeform'>('organized')
  const [showGlossary, setShowGlossary] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [showRandomizer, setShowRandomizer] = useState(false)
  const [showDeckImport, setShowDeckImport] = useState(false)
  const [showZone, setShowZone] = useState<InspectableZone | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [glossaryQuery, setGlossaryQuery] = useState('')
  const [randomMode, setRandomMode] = useState<'dice' | 'coin' | 'number' | 'player'>('dice')
  const [diceSides, setDiceSides] = useState(20)
  const [diceCount, setDiceCount] = useState(1)
  const [diceModifier, setDiceModifier] = useState(0)
  const [rangeMin, setRangeMin] = useState(1)
  const [rangeMax, setRangeMax] = useState(100)
  const [randomOverlay, setRandomOverlay] = useState<string | null>(null)
  const [phaseOverlay, setPhaseOverlay] = useState<string | null>(null)
  const [counterKind, setCounterKind] = useState('+1/+1')
  const [customCounterKind, setCustomCounterKind] = useState('Marker')
  const [counterAmount, setCounterAmount] = useState(1)
  const [counterColor, setCounterColor] = useState('green')
  const [contextMenu, setContextMenu] = useState<{ cardId: string; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState<null | {
    cardId: string
    startClientX: number
    startClientY: number
    startX: number
    startY: number
  }>(null)
  const [dragOverride, setDragOverride] = useState<Record<string, { x: number; y: number }>>({})
  const dragOverrideRef = useRef<Record<string, { x: number; y: number }>>({})
  const dragMovedRef = useRef(false)
  const lastLogRef = useRef<string | null>(null)
  const lastPhaseRef = useRef<Phase | null>(null)

  const notify = useCallback((message: string, duration = 2600) => {
    setToast(message)
    window.setTimeout(() => setToast(null), duration)
  }, [])

  const processIncomingState = useCallback((next: GameState) => {
    const newest = next.log[next.log.length - 1] ?? null
    if (newest && newest !== lastLogRef.current) {
      lastLogRef.current = newest
      if (/rolled|flipped a coin|randomized|random player/.test(newest)) {
        setRandomOverlay(newest)
        window.setTimeout(() => setRandomOverlay(null), 2200)
      }
    }
    const phase = next.turn?.phase
    if (phase && lastPhaseRef.current && phase !== lastPhaseRef.current) {
      setPhaseOverlay(phase.replaceAll('_', ' '))
      window.setTimeout(() => setPhaseOverlay(null), 1400)
    }
    if (phase) lastPhaseRef.current = phase
    setState(next)
  }, [])

  useEffect(() => {
    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    const onError = (error: Error) => {
      setConnected(false)
      notify(`Connection: ${error.message}`)
    }
    const onState = ({ state: next }: { state: GameState }) => processIncomingState(next)
    const onToast = ({ message }: { kind: 'info' | 'error'; message: string }) => notify(message)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onError)
    socket.on('state:full', onState)
    socket.on('state:patch', onState)
    socket.on('system:toast', onToast)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onError)
      socket.off('state:full', onState)
      socket.off('state:patch', onState)
      socket.off('system:toast', onToast)
      socket.disconnect()
    }
  }, [notify, processIncomingState, socket])

  useEffect(() => {
    dragOverrideRef.current = dragOverride
  }, [dragOverride])

  const sendAction = useCallback((action: GameAction) => socket.emit('game:action', action), [socket])

  useEffect(() => {
    if (!dragging) return
    const current = dragging
    const onMove = (event: PointerEvent) => {
      const dx = event.clientX - current.startClientX
      const dy = event.clientY - current.startClientY
      if (Math.abs(dx) + Math.abs(dy) > 4) dragMovedRef.current = true
      setDragOverride((previous) => ({
        ...previous,
        [current.cardId]: { x: current.startX + dx, y: current.startY + dy },
      }))
    }
    const onUp = () => {
      const position = dragOverrideRef.current[current.cardId] ?? { x: current.startX, y: current.startY }
      sendAction({
        type: 'card:setPos',
        cardId: current.cardId,
        x: Math.max(0, Math.min(1800, position.x)),
        y: Math.max(0, Math.min(500, position.y)),
      })
      setDragOverride((previous) => {
        const next = { ...previous }
        delete next[current.cardId]
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
  }, [dragging, sendAction])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [contextMenu])

  const me = state && playerId ? state.players[playerId] ?? null : null
  const opponents = useMemo(
    () => (state && playerId ? Object.values(state.players).filter((player) => player.id !== playerId) : []),
    [playerId, state],
  )
  const selectedCard = selectedCardId && state ? state.cards[selectedCardId] : null
  const previewCard = selectedCard
  const zoomedCard = zoomedCardId && state ? state.cards[zoomedCardId] : null
  const filteredGlossary = GLOSSARY.filter(([term, definition]) =>
    `${term} ${definition}`.toLowerCase().includes(glossaryQuery.toLowerCase()),
  )

  function createRoom() {
    const name = playerName.trim()
    if (!connected) return notify('The server is waking up. Try again in a moment.')
    if (!name) return notify('Enter your player name first.')
    socket.emit('room:create', { playerName: name, gameMode }, (response) => {
      if (!response.ok) return notify(response.error)
      setRoomCode(response.roomCode)
      setPlayerId(response.playerId)
      localStorage.setItem(LS_PLAYER_ID, response.playerId)
      processIncomingState(response.state)
    })
  }

  function joinRoom() {
    const name = playerName.trim()
    const code = joinCode.trim().toUpperCase()
    if (!connected) return notify('The server is waking up. Try again in a moment.')
    if (!name || !code) return notify('Enter your name and room code.')
    socket.emit(
      'room:join',
      { roomCode: code, playerName: name, playerId: localStorage.getItem(LS_PLAYER_ID) ?? undefined },
      (response) => {
        if (!response.ok) return notify(response.error)
        setRoomCode(response.roomCode)
        setPlayerId(response.playerId)
        localStorage.setItem(LS_PLAYER_ID, response.playerId)
        processIncomingState(response.state)
      },
    )
  }

  function importDeck() {
    const parsed = parseArenaDeck(deckText)
    if (!parsed.ok) return notify(parsed.error)
    socket.emit('deck:importArena', { deck: parsed.deck }, (response) => {
      if (!response.ok) return notify(response.error)
      notify('Deck imported and shuffled.')
      setShowDeckImport(false)
    })
  }

  function sendChat() {
    const text = chatText.trim()
    if (!text) return
    socket.emit('chat:send', { text })
    setChatText('')
  }

  function selectCard(cardId: string) {
    setSelectedCardId(cardId)
    setInspectorOpen(true)
  }

  function handleCardTap(cardId: string) {
    if (dragMovedRef.current) {
      dragMovedRef.current = false
      return
    }
    selectCard(cardId)
  }

  function defaultPosition(index: number) {
    return { x: 18 + (index % 11) * 112, y: 42 + Math.floor(index / 11) * 150 }
  }

  function renderedPosition(card: CardInstance, index: number) {
    return dragOverride[card.id] ?? card.battlefieldPos ?? defaultPosition(index)
  }

  function beginCardDrag(card: CardInstance, event: React.PointerEvent, index: number) {
    if (layoutMode !== 'freeform' || event.button !== 0) return
    const position = renderedPosition(card, index)
    dragMovedRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging({
      cardId: card.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: position.x,
      startY: position.y,
    })
    setDragOverride((previous) => ({ ...previous, [card.id]: position }))
  }

  function openContextMenu(cardId: string, event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    selectCard(cardId)
    setContextMenu({ cardId, x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 110) })
  }

  function dropIntoBattlefield(event: React.DragEvent, player: PlayerState) {
    event.preventDefault()
    const cardId = event.dataTransfer.getData('text/plain')
    if (!cardId || !state) return
    const card = state.cards[cardId]
    if (!card || card.ownerId !== player.id) return
    sendAction({ type: 'moveCard', cardId, toZone: 'battlefield' })
  }

  function renderCard(card: CardInstance, index: number, freeform = false) {
    const position = renderedPosition(card, index)
    return (
      <article
        key={card.id}
        className={`tableCard ${card.tapped ? 'tapped' : ''} ${selectedCardId === card.id ? 'selected' : ''} tag-${card.colorTag ?? 'none'}`}
        style={freeform ? { left: position.x, top: position.y } : undefined}
        onClick={() => handleCardTap(card.id)}
        onContextMenu={(event) => openContextMenu(card.id, event)}
        onPointerDown={(event) => beginCardDrag(card, event, index)}
        title="Click to select and preview · Right-click to color tag"
      >
        {card.definition.imageUrl ? (
          <img src={card.definition.imageUrl} alt={card.definition.name} draggable={false} />
        ) : (
          <div className="cardPlaceholder">{card.definition.name}</div>
        )}
        {card.counters.length > 0 && (
          <div className="counterStack">
            {card.counters.slice(0, 3).map((counter) => (
              <span key={counter.id} className={`counterChip counter-${counter.color ?? 'gray'}`}>
                {counter.kind} {counter.amount}
              </span>
            ))}
          </div>
        )}
        {card.attachedTo && <span className="attachedMark">⌁</span>}
      </article>
    )
  }

  function battlefieldZone(player: PlayerState, isMe: boolean) {
    const cards = player.battlefield.map((id) => state?.cards[id]).filter((card): card is CardInstance => Boolean(card))
    return (
      <section
        key={player.id}
        className={`playerBattlefield ${isMe ? 'mine' : 'opponent'}`}
        onDragOver={(event) => isMe && event.preventDefault()}
        onDrop={(event) => isMe && dropIntoBattlefield(event, player)}
      >
        <header className="battlefieldHeader">
          <div>
            <span className="playerDot" />
            <strong>{player.name}</strong>
            {isMe && <span className="youLabel">You</span>}
          </div>
          <div className="zoneSummary">{cards.length} permanents · {player.hand.length} cards in hand</div>
        </header>
        {layoutMode === 'organized' ? (
          <div className="organizedBoard">
            {BOARD_CATEGORIES.map((category) => {
              const categoryCards = cards.filter((card) => cardCategory(card) === category)
              return (
                <div className={`typeLane lane-${category}`} key={category}>
                  <div className="laneLabel">
                    <span>{categoryLabel(category)}</span>
                    <b>{categoryCards.length}</b>
                  </div>
                  <div className="laneCards">{categoryCards.map((card, index) => renderCard(card, index))}</div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="freeformBoard">{cards.map((card, index) => renderCard(card, index, true))}</div>
        )}
        {cards.length === 0 && <div className="emptyBattlefield">{isMe ? 'Drag a card here from your hand' : 'No permanents yet'}</div>}
      </section>
    )
  }

  function runRandomizer() {
    if (!playerId) return
    if (randomMode === 'dice') sendAction({ type: 'random:rollDice', playerId, sides: diceSides, count: diceCount, modifier: diceModifier })
    if (randomMode === 'coin') sendAction({ type: 'random:coinFlip', playerId })
    if (randomMode === 'number') sendAction({ type: 'random:number', playerId, min: rangeMin, max: rangeMax })
    if (randomMode === 'player') sendAction({ type: 'random:choosePlayer', playerId })
  }

  if (!roomCode || !state || !playerId) {
    return (
      <main className="landingPage">
        <div className="landingGlow glowOne" />
        <div className="landingGlow glowTwo" />
        <nav className="landingNav">
          <div className="brand"><span>DeckHub <small>for Magic: The Gathering</small></span></div>
          <div className={`serverStatus ${connected ? 'online' : 'waking'}`}><span />{connected ? 'Server online' : 'Server waking'}</div>
        </nav>
        <section className="heroSection">
          <div className="entryCard">
            <div className="entryTabs"><span className="active">Start playing</span><span>No account required</span></div>
            <label>Player name<input value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="How should players see you?" maxLength={32} /></label>
            <label>Format<select value={gameMode} onChange={(event) => setGameMode(event.target.value as GameMode)}>
              {['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'brawl', 'custom'].map((mode) => <option value={mode} key={mode}>{mode[0].toUpperCase() + mode.slice(1)}</option>)}
            </select></label>
            <button className="primaryButton" onClick={createRoom} disabled={!playerName.trim() || !connected}>Create a new table</button>
            <div className="orDivider"><span />or join a friend<span /></div>
            <div className="joinRow"><input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="ROOM CODE" maxLength={6} /><button onClick={joinRoom} disabled={!playerName.trim() || !joinCode.trim() || !connected}>Join</button></div>
            <p className="entryNote">Rooms are temporary and disappear when the free server restarts.</p>
          </div>
        </section>
        {toast && <div className="globalToast">{toast}</div>}
      </main>
    )
  }

  return (
    <main className="tableApp">
      <header className="topBar">
        <div className="brand compact"><span>DeckHub <small>for MTG</small></span></div>
        <div className="roomIdentity"><span>Room</span><button onClick={() => navigator.clipboard.writeText(roomCode).then(() => notify('Room code copied.'))}>{roomCode}</button><span className="modePill">{state.gameMode}</span></div>
        <div className="topActions">
          <button onClick={() => setShowRules(true)}>Rules</button>
          <button onClick={() => setShowGlossary(true)}>MTG index</button>
          <button className="accentButton" onClick={() => setShowRandomizer((open) => !open)}>◇ Randomizer</button>
          <button className="inspectorToggle" onClick={() => setInspectorOpen((open) => !open)}>Card</button>
          <span className={`connectionDot ${connected ? 'online' : ''}`} title={connected ? 'Connected' : 'Disconnected'} />
        </div>
      </header>

      <div className="workspace">
        <aside className="leftRail panelSurface">
          <section className="railSection playersSection">
            <div className="sectionHeading"><span>Players</span><small>{Object.keys(state.players).length}</small></div>
            {Object.values(state.players).map((player) => (
              <article className={`playerRow ${player.id === playerId ? 'active' : ''}`} key={player.id}>
                <div className="avatar">{player.name.charAt(0).toUpperCase()}</div>
                <div className="playerInfo"><strong>{player.name}</strong><span>{player.hand.length} hand · {player.library.length} library</span></div>
                <div className="lifeControl"><button onClick={() => sendAction({ type: 'setLife', playerId: player.id, life: player.life - 1 })}>−</button><b>{player.life}</b><button onClick={() => sendAction({ type: 'setLife', playerId: player.id, life: player.life + 1 })}>+</button></div>
              </article>
            ))}
          </section>

          <section className="railSection">
            <div className="sectionHeading"><span>Turn</span><small>#{state.turn?.number ?? 1}</small></div>
            <div className="phaseTrack">
              {PHASES.map((phase, index) => <button key={phase.value} className={state.turn?.phase === phase.value ? 'active' : ''} onClick={() => sendAction({ type: 'turn:setPhase', playerId, phase: phase.value })}><i>{index + 1}</i><span>{phase.label}</span></button>)}
            </div>
            <button className="wideButton" onClick={() => sendAction({ type: 'turn:nextPhase', playerId })}>Advance phase <span>→</span></button>
          </section>

          <section className="railSection quickActions">
            <div className="sectionHeading"><span>Quick actions</span></div>
            <div className="actionGrid">
              <button onClick={() => sendAction({ type: 'draw', playerId, count: 1 })}><b>＋</b>Draw</button>
              <button onClick={() => sendAction({ type: 'shuffleLibrary', playerId })}><b>↻</b>Shuffle</button>
              <button onClick={() => sendAction({ type: 'mulligan', playerId })}><b>⟳</b>Mulligan</button>
              <button onClick={() => setShowDeckImport(true)}><b>⇧</b>Import</button>
            </div>
          </section>

          <section className="railSection zoneCounts">
            <div className="sectionHeading"><span>Your zones</span></div>
            <div><button onClick={() => setShowZone('library')}>Library</button><b>{me?.library.length ?? 0}</b></div>
            <div><button onClick={() => setShowZone('graveyard')}>Graveyard</button><b>{me?.graveyard.length ?? 0}</b></div>
            <div><button onClick={() => setShowZone('exile')}>Exile</button><b>{me?.exile.length ?? 0}</b></div>
            <div><button onClick={() => setShowZone('command')}>Command</button><b>{me?.command.length ?? 0}</b></div>
            <div><button onClick={() => setShowZone('sideboard')}>Sideboard</button><b>{me?.sideboard.length ?? 0}</b></div>
          </section>
        </aside>

        <section className="centerStage">
          <div className="boardToolbar">
            <div><strong>Battlefield</strong><span>Select a card to preview</span></div>
            <div className="segmentedControl"><button className={layoutMode === 'organized' ? 'active' : ''} onClick={() => setLayoutMode('organized')}>Organized</button><button className={layoutMode === 'freeform' ? 'active' : ''} onClick={() => setLayoutMode('freeform')}>Freeform</button></div>
          </div>
          <div className="battlefields">
            {opponents.length ? opponents.map((opponent) => battlefieldZone(opponent, false)) : <div className="waitingZone"><span>◎</span><strong>Waiting for an opponent</strong><p>Share room code {roomCode}</p></div>}
            {me && battlefieldZone(me, true)}
          </div>

          <section className="handShelf">
            <div className="handHeader"><div><strong>Your hand</strong><span>{me?.hand.length ?? 0} cards</span></div><span>Drag to your battlefield</span></div>
            <div className="handCards">
              {(me?.hand ?? []).map((cardId) => {
                const card = state.cards[cardId]
                if (!card) return null
                return <article key={card.id} className={`handCard tag-${card.colorTag ?? 'none'} ${selectedCardId === card.id ? 'selected' : ''}`} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)} onClick={() => handleCardTap(card.id)} onContextMenu={(event) => openContextMenu(card.id, event)}>{card.definition.imageUrl ? <img src={card.definition.imageUrl} alt={card.definition.name} draggable={false} /> : <div className="cardPlaceholder">{card.definition.name}</div>}</article>
              })}
              {(me?.hand.length ?? 0) === 0 && <div className="emptyHand">Your hand is empty. Draw a card to begin.</div>}
            </div>
          </section>
        </section>

        <aside className={`rightRail panelSurface ${inspectorOpen ? 'open' : ''}`}>
          <section className="railSection previewSection">
            <div className="sectionHeading"><span>Card preview</span>{previewCard && <div className="previewHeaderActions"><button onClick={() => setZoomedCardId(previewCard.id)} aria-label="Open large card preview" title="Open large preview">⛶</button></div>}</div>
            {previewCard ? <div className="largePreview">{previewCard.definition.imageUrl ? <img src={previewCard.definition.imageUrl} alt={previewCard.definition.name} /> : <div className="cardPlaceholder">{previewCard.definition.name}</div>}<strong>{previewCard.definition.name}</strong><span>{previewCard.definition.typeLine ?? 'Card details loading…'}</span></div> : <div className="previewEmpty"><span>◫</span><p>Select any card to inspect it here.</p></div>}
          </section>

          <section className="railSection selectedSection">
            <div className="sectionHeading"><span>Selected card</span></div>
            {selectedCard ? <>
              <div className="selectedTitle"><strong>{selectedCard.definition.name}</strong><span>{selectedCard.zone}</span></div>
              <div className="cardTagEditor"><span>Border tag</span><div>{CARD_TAGS.map((color) => <button key={color} className={`bg-${color} ${selectedCard.colorTag === color ? 'active' : ''}`} onClick={() => sendAction({ type: 'card:setColorTag', cardId: selectedCard.id, color })} aria-label={`${color} border`} />)}<button className="clearTag" onClick={() => sendAction({ type: 'card:setColorTag', cardId: selectedCard.id })}>×</button></div></div>
              <div className="selectedActions">
                {selectedCard.zone === 'battlefield' && <button onClick={() => sendAction({ type: 'tapToggle', cardId: selectedCard.id })}>{selectedCard.tapped ? 'Untap' : 'Tap'}</button>}
                {selectedCard.zone !== 'battlefield' && <button onClick={() => sendAction({ type: 'moveCard', cardId: selectedCard.id, toZone: 'battlefield' })}>Battlefield</button>}
                <button onClick={() => sendAction({ type: 'moveCard', cardId: selectedCard.id, toZone: 'hand' })}>Hand</button>
                <button onClick={() => sendAction({ type: 'moveCard', cardId: selectedCard.id, toZone: 'graveyard' })}>Graveyard</button>
                <button onClick={() => sendAction({ type: 'moveCard', cardId: selectedCard.id, toZone: 'exile' })}>Exile</button>
              </div>
              <div className="counterEditor">
                <div className="subheading">Counters</div>
                {selectedCard.counters.map((counter) => <div className="counterControl" key={counter.id}><span className={`colorDot bg-${counter.color ?? 'gray'}`} /><strong>{counter.kind}</strong><button onClick={() => sendAction({ type: 'counter:add', cardId: selectedCard.id, kind: counter.kind, amount: -1, color: counter.color })}>−</button><b>{counter.amount}</b><button onClick={() => sendAction({ type: 'counter:add', cardId: selectedCard.id, kind: counter.kind, amount: 1, color: counter.color })}>+</button><button className="removeButton" onClick={() => sendAction({ type: 'counter:set', cardId: selectedCard.id, kind: counter.kind, amount: 0 })}>×</button></div>)}
                <div className="newCounter"><select value={counterKind} onChange={(event) => setCounterKind(event.target.value)}><option>+1/+1</option><option>-1/-1</option><option>Loyalty</option><option>Charge</option><option>Shield</option><option>Stun</option><option>Quest</option><option>Custom</option></select><input type="number" min="-99" max="99" value={counterAmount} onChange={(event) => setCounterAmount(Number(event.target.value))} />{counterKind === 'Custom' && <input className="customCounterName" value={customCounterKind} onChange={(event) => setCustomCounterKind(event.target.value)} placeholder="Counter name" maxLength={24} />}<div className="miniPalette">{COUNTER_COLORS.map((color) => <button key={color} className={`bg-${color} ${counterColor === color ? 'active' : ''}`} onClick={() => setCounterColor(color)} aria-label={`${color} counter`} />)}</div><button className="addCounterButton" onClick={() => { const kind = counterKind === 'Custom' ? customCounterKind.trim() : counterKind; if (kind) sendAction({ type: 'counter:add', cardId: selectedCard.id, kind, amount: counterAmount, color: counterColor }) }}>Add counter</button></div>
              </div>
              <div className="attachmentControls">
                {!attachFrom ? <button onClick={() => setAttachFrom(selectedCard.id)}>Start attachment</button> : attachFrom !== selectedCard.id ? <><span>Attach {state.cards[attachFrom]?.definition.name ?? 'card'} here?</span><button onClick={() => { sendAction({ type: 'attach', attachmentCardId: attachFrom, targetCardId: selectedCard.id }); setAttachFrom(null) }}>Attach</button><button onClick={() => setAttachFrom(null)}>Cancel</button></> : <button onClick={() => setAttachFrom(null)}>Cancel attachment</button>}
                {selectedCard.attachedTo && <button onClick={() => sendAction({ type: 'detach', attachmentCardId: selectedCard.id })}>Detach</button>}
              </div>
            </> : <div className="selectedEmpty">Select a card to reveal tabletop controls.</div>}
          </section>

          <section className="railSection activitySection">
            <div className="sectionHeading"><span>Table activity</span><small>Live</small></div>
            <div className="activityLog">{state.log.slice(-30).reverse().map((line, index) => <div className="activityItem" key={`${line}-${index}`}><i>{logIcon(line)}</i><span>{line}</span><time>{index === 0 ? 'now' : ''}</time></div>)}</div>
          </section>

          <section className="railSection chatSection">
            <div className="sectionHeading"><span>Table chat</span></div>
            <div className="chatLog">{state.chat.slice(-30).map((message) => <div key={message.id}><strong>{state.players[message.playerId]?.name ?? 'Player'}</strong><span>{message.text}</span></div>)}</div>
            <div className="chatComposer"><input value={chatText} onChange={(event) => setChatText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && sendChat()} placeholder="Message the table…" /><button onClick={sendChat}>↑</button></div>
          </section>
        </aside>
      </div>

      {showRandomizer && <div className="floatingPanel randomizerPanel">
        <div className="floatingHeader"><div><small>Table tool</small><strong>Randomizer</strong></div><button onClick={() => setShowRandomizer(false)}>×</button></div>
        <div className="randomTabs">{(['dice', 'coin', 'number', 'player'] as const).map((mode) => <button key={mode} className={randomMode === mode ? 'active' : ''} onClick={() => setRandomMode(mode)}>{mode}</button>)}</div>
        {randomMode === 'dice' && <><div className="dicePicker">{DICE.map((sides) => <button key={sides} className={diceSides === sides ? 'active' : ''} onClick={() => setDiceSides(sides)}><span>◇</span>d{sides}</button>)}</div><div className="randomFields"><label>Dice<input type="number" min="1" max="20" value={diceCount} onChange={(event) => setDiceCount(Number(event.target.value))} /></label><label>Modifier<input type="number" min="-999" max="999" value={diceModifier} onChange={(event) => setDiceModifier(Number(event.target.value))} /></label></div></>}
        {randomMode === 'coin' && <div className="randomDescription"><span>◐</span><p>Flip a synchronized coin visible to everyone at the table.</p></div>}
        {randomMode === 'number' && <div className="randomFields"><label>Minimum<input type="number" value={rangeMin} onChange={(event) => setRangeMin(Number(event.target.value))} /></label><label>Maximum<input type="number" value={rangeMax} onChange={(event) => setRangeMax(Number(event.target.value))} /></label></div>}
        {randomMode === 'player' && <div className="randomDescription"><span>◎</span><p>Choose one connected player at random.</p></div>}
        <button className="primaryButton" onClick={runRandomizer}>{randomMode === 'dice' ? `Roll ${diceCount}d${diceSides}` : randomMode === 'coin' ? 'Flip coin' : randomMode === 'number' ? 'Pick number' : 'Choose player'}</button>
      </div>}

      {showGlossary && <div className="modalBackdrop" onMouseDown={() => setShowGlossary(false)}><section className="modalSheet glossaryModal" onMouseDown={(event) => event.stopPropagation()}><header><div><small>Reference library</small><h2>Magic terminology</h2></div><button onClick={() => setShowGlossary(false)}>×</button></header><input className="searchInput" value={glossaryQuery} onChange={(event) => setGlossaryQuery(event.target.value)} placeholder="Search keywords and concepts…" /><div className="glossaryList">{filteredGlossary.map(([term, definition]) => <details key={term}><summary>{term}<span>＋</span></summary><p>{definition}</p></details>)}</div></section></div>}
      {showRules && <div className="modalBackdrop" onMouseDown={() => setShowRules(false)}><section className="modalSheet rulesModal" onMouseDown={(event) => event.stopPropagation()}><header><div><small>Rules-light guide</small><h2>Playing at this table</h2></div><button onClick={() => setShowRules(false)}>×</button></header><p className="modalIntro">Arcane Table provides structure without acting as a judge. The official Magic rules still apply, but players remain free to communicate shortcuts and correct mistakes.</p><div className="rulesList">{RULES.map(([title, body]) => <article key={title}><b>{title}</b><p>{body}</p></article>)}</div><div className="rulesCallout"><strong>Golden rule</strong><span>If all players understand and agree on the game state, keep playing.</span></div></section></div>}
      {showDeckImport && <div className="modalBackdrop" onMouseDown={() => setShowDeckImport(false)}><section className="modalSheet deckModal" onMouseDown={(event) => event.stopPropagation()}><header><div><small>Deck setup</small><h2>Import from MTG Arena</h2></div><button onClick={() => setShowDeckImport(false)}>×</button></header><p className="modalIntro">Paste an Arena-formatted deck list. Importing replaces your current cards and shuffles the new library.</p><textarea value={deckText} onChange={(event) => setDeckText(event.target.value)} placeholder={'Deck\n4 Lightning Strike (DMU) 137\n…'} rows={14} /><div className="modalActions"><button onClick={() => setDeckText('')}>Clear</button><button className="primaryButton" onClick={importDeck}>Import and shuffle</button></div></section></div>}
      {zoomedCard && <div className="modalBackdrop cardZoomBackdrop" onMouseDown={() => setZoomedCardId(null)}><section className="cardZoomModal" onMouseDown={(event) => event.stopPropagation()}><header><div><small>Card preview</small><strong>{zoomedCard.definition.name}</strong><span>{zoomedCard.definition.typeLine}</span></div><button onClick={() => setZoomedCardId(null)} aria-label="Close large preview">×</button></header><div className="zoomedFaces">{zoomedCard.definition.faces?.some((face) => face.imageUrl) ? zoomedCard.definition.faces.filter((face) => face.imageUrl).map((face) => <figure key={face.name}><img src={face.imageUrl} alt={face.name} /><figcaption>{face.name}</figcaption></figure>) : zoomedCard.definition.imageUrl ? <figure><img src={zoomedCard.definition.imageUrl} alt={zoomedCard.definition.name} /></figure> : <div className="zoomPlaceholder">No card image is available yet.</div>}</div><p>Click outside the card or press the close button to return to the table.</p></section></div>}
      {showZone && me && <div className="modalBackdrop" onMouseDown={() => setShowZone(null)}><section className="modalSheet zoneModal" onMouseDown={(event) => event.stopPropagation()}><header><div><small>Your zones</small><h2>{showZone.charAt(0).toUpperCase() + showZone.slice(1)}</h2></div><button onClick={() => setShowZone(null)}>×</button></header><div className="zoneModalToolbar"><span>{me[showZone].length} cards</span>{showZone === 'library' && <button onClick={() => sendAction({ type: 'shuffleLibrary', playerId })}>Shuffle library</button>}</div><div className="zoneCardGrid">{me[showZone].slice().reverse().map((cardId) => { const card = state.cards[cardId]; if (!card) return null; return <article key={card.id} className={`zoneCard tag-${card.colorTag ?? 'none'}`} onClick={() => handleCardTap(card.id)} onContextMenu={(event) => openContextMenu(card.id, event)}>{card.definition.imageUrl ? <img src={card.definition.imageUrl} alt={card.definition.name} /> : <div className="cardPlaceholder">{card.definition.name}</div>}<strong>{card.definition.name}</strong><div><button onClick={(event) => { event.stopPropagation(); sendAction({ type: 'moveCard', cardId: card.id, toZone: 'hand' }) }}>Hand</button><button onClick={(event) => { event.stopPropagation(); sendAction({ type: 'moveCard', cardId: card.id, toZone: 'battlefield' }) }}>Battlefield</button>{showZone !== 'graveyard' && <button onClick={(event) => { event.stopPropagation(); sendAction({ type: 'moveCard', cardId: card.id, toZone: 'graveyard' }) }}>GY</button>}{showZone !== 'exile' && <button onClick={(event) => { event.stopPropagation(); sendAction({ type: 'moveCard', cardId: card.id, toZone: 'exile' }) }}>Exile</button>}</div></article>})}{me[showZone].length === 0 && <div className="emptyZone">No cards in this zone.</div>}</div></section></div>}

      {contextMenu && <div className="cardContextMenu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}><span>Card border color</span><div>{CARD_TAGS.map((color) => <button key={color} className={`bg-${color}`} onClick={() => { sendAction({ type: 'card:setColorTag', cardId: contextMenu.cardId, color }); setContextMenu(null) }} aria-label={color} />)}<button className="clearTag" onClick={() => { sendAction({ type: 'card:setColorTag', cardId: contextMenu.cardId }); setContextMenu(null) }}>×</button></div></div>}
      {randomOverlay && <div className="resultOverlay"><span>◇</span><strong>{randomOverlay}</strong></div>}
      {phaseOverlay && <div className="phaseOverlay">{phaseOverlay}</div>}
      {toast && <div className="globalToast">{toast}</div>}
    </main>
  )
}

export default App
