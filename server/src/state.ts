import { nanoid } from 'nanoid';
import type { GameMode, GameState, PlayerId, PlayerState, RoomCode } from '@mtg-online/shared';

export type Room = {
    code: RoomCode;
    state: GameState;
};

export function createRoom(code: RoomCode, hostPlayer: { id: PlayerId; name: string }, gameMode: GameMode): Room {
    const now = Date.now();
    const host: PlayerState = {
        id: hostPlayer.id,
        name: hostPlayer.name,
        life: 20,
        poison: 0,
        mulligans: 0,
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: [],
        sideboard: [],
    };

    const state: GameState = {
        roomCode: code,
        createdAt: now,
        updatedAt: now,
        gameMode,
        players: { [host.id]: host },
        cards: {},
        chat: [],
        log: [`Room created by ${host.name}`],
        turn: {
            activePlayerId: host.id,
            number: 1,
            phase: 'beginning',
        },
    };

    return { code, state };
}

export function addOrReconnectPlayer(room: Room, player: { id: PlayerId; name: string }): void {
    const existing = room.state.players[player.id];
    if (existing) {
        existing.name = player.name;
        room.state.log.push(`${player.name} reconnected`);
    } else {
        room.state.players[player.id] = {
            id: player.id,
            name: player.name,
            life: 20,
            poison: 0,
            mulligans: 0,
            library: [],
            hand: [],
            battlefield: [],
            graveyard: [],
            exile: [],
            command: [],
            sideboard: [],
        };
        room.state.log.push(`${player.name} joined`);
    }
    room.state.updatedAt = Date.now();
}

export function newMessageId(): string {
    return nanoid(10);
}
