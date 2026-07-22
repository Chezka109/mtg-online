export type RoomCode = string;
export type PlayerId = string;
export type CardId = string;

export type GameMode = 'standard' | 'pioneer' | 'modern' | 'legacy' | 'vintage' | 'commander' | 'brawl' | 'custom';

export type Phase = 'beginning' | 'precombat_main' | 'combat' | 'postcombat_main' | 'ending';

export type Zone =
    | 'library'
    | 'hand'
    | 'battlefield'
    | 'graveyard'
    | 'exile'
    | 'stack'
    | 'command'
    | 'sideboard';

export type Attachment = {
    id: string;
    attachedToCardId: CardId;
};

export type Counter = {
    id: string;
    kind: string; // e.g. "+1/+1", "loyalty", "poison", "energy"
    amount: number;
    color?: string;
};

export type CardFace = {
    name: string;
    imageUrl?: string;
};

export type CardDefinition = {
    name: string;
    scryfallId?: string;
    scryfallOracleId?: string;
    faces?: CardFace[];
    imageUrl?: string; // single-faced convenience
    typeLine?: string;
};

export type CardInstance = {
    id: CardId;
    ownerId: PlayerId;
    controllerId: PlayerId;
    definition: CardDefinition;
    zone: Zone;
    battlefieldPos?: {
        x: number;
        y: number;
    };
    tapped: boolean;
    counters: Counter[];
    attachments: Attachment[]; // things attached to this card
    attachedTo?: CardId; // if this is an aura/equipment attached to something
    colorTag?: string;
    notes?: string;
};

export type PlayerState = {
    id: PlayerId;
    name: string;
    life: number;
    poison: number;
    mulligans: number;
    library: CardId[];
    hand: CardId[];
    battlefield: CardId[];
    graveyard: CardId[];
    exile: CardId[];
    command: CardId[];
    sideboard: CardId[];
};

export type ChatMessage = {
    id: string;
    at: number;
    playerId: PlayerId;
    text: string;
};

export type GameState = {
    roomCode: RoomCode;
    createdAt: number;
    updatedAt: number;
    gameMode: GameMode;
    players: Record<PlayerId, PlayerState>;
    cards: Record<CardId, CardInstance>;
    chat: ChatMessage[];
    log: string[];
    turn?: {
        activePlayerId: PlayerId;
        number: number;
        phase: Phase;
    };
};

export type GameAction =
    | { type: 'draw'; playerId: PlayerId; count?: number }
    | { type: 'shuffleLibrary'; playerId: PlayerId }
    | { type: 'mulligan'; playerId: PlayerId }
    | { type: 'moveCard'; cardId: CardId; toZone: Zone; toPlayerId?: PlayerId }
    | { type: 'tapToggle'; cardId: CardId }
    | { type: 'setLife'; playerId: PlayerId; life: number }
    | { type: 'counter:add'; cardId: CardId; kind: string; amount?: number; color?: string }
    | { type: 'counter:set'; cardId: CardId; kind: string; amount: number }
    | { type: 'counter:clear'; cardId: CardId }
    | { type: 'card:setColorTag'; cardId: CardId; color?: string }
    | { type: 'attach'; attachmentCardId: CardId; targetCardId: CardId }
    | { type: 'detach'; attachmentCardId: CardId }
    | { type: 'card:setPos'; cardId: CardId; x: number; y: number }
    | { type: 'turn:setPhase'; playerId: PlayerId; phase: Phase }
    | { type: 'turn:nextPhase'; playerId: PlayerId }
    | { type: 'dice:rollD20'; playerId: PlayerId }
    | { type: 'random:rollDice'; playerId: PlayerId; sides: number; count: number; modifier?: number }
    | { type: 'random:coinFlip'; playerId: PlayerId }
    | { type: 'random:number'; playerId: PlayerId; min: number; max: number }
    | { type: 'random:choosePlayer'; playerId: PlayerId };

export type ArenaDeckSection = 'main' | 'sideboard' | 'commander';

export type ArenaDeckLine = {
    section: ArenaDeckSection;
    quantity: number;
    name: string;
    setCode?: string;
    collectorNumber?: string;
};

export type ArenaDeckImport = {
    name?: string;
    lines: ArenaDeckLine[];
};
