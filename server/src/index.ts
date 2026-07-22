import http from 'node:http';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { nanoid } from 'nanoid';
import { Server } from 'socket.io';
import type { ClientToServerEvents, GameAction, ServerToClientEvents } from '@mtg-online/shared';
import type { RoomCode } from '@mtg-online/shared';

import { applyAction, createPlaceholderCard } from './actions.js';
import { addOrReconnectPlayer, createRoom, newMessageId, type Room } from './state.js';
import { loadCardIndex, resolveFromArenaLine } from './cardIndex.js';
import { getScryfallImageData } from './scryfall.js';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;

const DEV_ORIGINS = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] as const;

function isAllowedOrigin(origin: string | undefined): boolean {
    // Non-browser clients (curl, health checks) often omit Origin.
    if (!origin) return true;
    if (CLIENT_ORIGIN && origin === CLIENT_ORIGIN) return true;
    return DEV_ORIGINS.some((re) => re.test(origin));
}

function corsOriginCb(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void): void {
    try {
        cb(null, isAllowedOrigin(origin));
    } catch (e) {
        cb(e instanceof Error ? e : new Error('CORS origin check failed'));
    }
}

function makeRoomCode(): RoomCode {
    // 6-char uppercase + digits, human shareable
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, () => alphabet[Math.floor(Math.random() * alphabet.length)]);
}

const app = express();
app.use(cors({ origin: corsOriginCb, credentials: true }));
app.get('/healthz', (_req: Request, res: Response) => res.json({ ok: true }));

const cardIndex = loadCardIndex();

app.get('/index/status', (_req: Request, res: Response) => {
    res.json({ ok: true, hasIndex: Boolean(cardIndex), meta: cardIndex?.meta ?? null });
});

const httpServer = http.createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: corsOriginCb, credentials: true },
});

const rooms = new Map<RoomCode, Room>();

function broadcastRoom(room: Room): void {
    io.to(room.code).emit('state:full', { state: room.state });
}

async function hydrateImages(room: Room, scryfallIds: string[]): Promise<void> {
    const uniq = [...new Set(scryfallIds.map((s) => s.trim()).filter(Boolean))];
    for (const id of uniq) {
        try {
            const data = await getScryfallImageData(id);
            let changed = false;
            for (const c of Object.values(room.state.cards)) {
                if (c.definition.scryfallId !== id) continue;
                if (!c.definition.imageUrl && data.imageUrl) {
                    c.definition.imageUrl = data.imageUrl;
                    changed = true;
                }
                if (!c.definition.faces && data.faces?.length) {
                    c.definition.faces = data.faces;
                    changed = true;
                }
                if (!c.definition.typeLine && data.typeLine) {
                    c.definition.typeLine = data.typeLine;
                    changed = true;
                }
            }
            if (changed) broadcastRoom(room);
            await new Promise((r) => setTimeout(r, 120));
        } catch {
            // ignore per-card failures
        }
    }
}

io.on('connection', (socket) => {
    let roomCode: RoomCode | null = null;
    let playerId: string | null = null;

    socket.on('room:create', ({ playerName, gameMode }, cb) => {
        try {
            const code = makeRoomCode();
            const pid = nanoid(12);
            const room = createRoom(code, { id: pid, name: playerName.trim().slice(0, 32) || 'Player' }, gameMode);
            rooms.set(code, room);

            roomCode = code;
            playerId = pid;
            void socket.join(code);

            cb({ ok: true, roomCode: code, playerId: pid, state: room.state });
            broadcastRoom(room);
        } catch (e) {
            cb({ ok: false, error: e instanceof Error ? e.message : 'create failed' });
        }
    });

    socket.on('room:join', ({ roomCode: code, playerName, playerId: maybePid }, cb) => {
        const room = rooms.get(code);
        if (!room) return cb({ ok: false, error: 'Room not found' });

        const pid = (maybePid ?? nanoid(12)).slice(0, 32);
        addOrReconnectPlayer(room, { id: pid, name: playerName.trim().slice(0, 32) || 'Player' });

        roomCode = code;
        playerId = pid;
        void socket.join(code);

        cb({ ok: true, roomCode: code, playerId: pid, state: room.state });
        broadcastRoom(room);
    });

    socket.on('chat:send', ({ text }) => {
        if (!roomCode || !playerId) return;
        const room = rooms.get(roomCode);
        if (!room) return;

        const p = room.state.players[playerId];
        if (!p) return;

        const msg = text.trim();
        if (!msg) return;

        room.state.chat.push({ id: newMessageId(), at: Date.now(), playerId, text: msg.slice(0, 500) });
        room.state.updatedAt = Date.now();
        broadcastRoom(room);
    });

    socket.on('deck:importArena', ({ deck }, cb) => {
        if (!roomCode || !playerId) return cb({ ok: false, error: 'Not in a room' });
        const room = rooms.get(roomCode);
        if (!room) return cb({ ok: false, error: 'Room not found' });
        const p = room.state.players[playerId];
        if (!p) return cb({ ok: false, error: 'Player not found' });

        // Resolve using the prebuilt index (server/data/card-index.json) and hydrate images async.
        const main = deck.lines.filter((l) => l.section === 'main');
        if (main.length === 0) return cb({ ok: false, error: 'Deck has no mainboard cards' });

        // Clear previous state
        for (const cid of [...p.library, ...p.hand, ...p.battlefield, ...p.graveyard, ...p.exile, ...p.command, ...p.sideboard]) {
            delete room.state.cards[cid];
        }
        p.library = [];
        p.hand = [];
        p.battlefield = [];
        p.graveyard = [];
        p.exile = [];
        p.command = [];
        p.sideboard = [];
        p.mulligans = 0;

        const created: string[] = [];
        const scryfallIds: string[] = [];
        for (const line of main) {
            const qty = Math.max(0, Math.min(400, Math.trunc(line.quantity)));
            const def = resolveFromArenaLine(cardIndex, line);
            if (def.scryfallId) scryfallIds.push(def.scryfallId);
            for (let i = 0; i < qty; i++) {
                const card = createPlaceholderCard(playerId, def.name);
                card.definition = def;
                room.state.cards[card.id] = card;
                p.library.push(card.id);
                created.push(card.id);
            }
        }

        applyAction(room.state, { type: 'shuffleLibrary', playerId } satisfies GameAction);
        room.state.log.push(`${p.name} imported a deck (${created.length} cards)`);

        cb({ ok: true });
        broadcastRoom(room);
        void hydrateImages(room, scryfallIds);
    });

    socket.on('game:action', (payload) => {
        if (!roomCode || !playerId) return;
        const room = rooms.get(roomCode);
        if (!room) return;

        const action = payload as GameAction;
        // basic safety: ensure player can only act as themselves
        if ('playerId' in action && (action as any).playerId && (action as any).playerId !== playerId) {
            // Tabletop convenience: allow adjusting any player's life total.
            if ((action as any).type !== 'setLife') return;
        }

        applyAction(room.state, action);
        broadcastRoom(room);
    });

    socket.on('disconnect', () => {
        // keep rooms in memory; no-op for now
    });
});

httpServer.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`server listening on http://localhost:${PORT}`);
});
