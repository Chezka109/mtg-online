import type { ArenaDeckImport, GameAction, GameMode, GameState, PlayerId, RoomCode } from './types.js';

export type ClientToServerEvents = {
    'room:create': (
        payload: { playerName: string; gameMode: GameMode },
        cb: (res: { ok: true; roomCode: RoomCode; playerId: PlayerId; state: GameState } | { ok: false; error: string }) => void
    ) => void;

    'room:join': (
        payload: { roomCode: RoomCode; playerName: string; playerId?: PlayerId },
        cb: (res: { ok: true; roomCode: RoomCode; playerId: PlayerId; state: GameState } | { ok: false; error: string }) => void
    ) => void;

    'chat:send': (payload: { text: string }) => void;

    'deck:importArena': (
        payload: { deck: ArenaDeckImport },
        cb: (res: { ok: true } | { ok: false; error: string; details?: string[] }) => void
    ) => void;

    'game:action': (payload: GameAction) => void;
};

export type ServerToClientEvents = {
    'state:full': (payload: { state: GameState }) => void;
    'state:patch': (payload: { state: GameState }) => void; // simple for now; later can send JSON patches
    'system:toast': (payload: { kind: 'info' | 'error'; message: string }) => void;
};
