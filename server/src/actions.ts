import { nanoid } from 'nanoid';
import type { Attachment, CardId, CardInstance, GameAction, GameState, Phase, PlayerId, Zone } from '@mtg-online/shared';

const PHASES: Phase[] = ['beginning', 'precombat_main', 'combat', 'postcombat_main', 'ending'];
const CARD_TAG_COLORS = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'white']);
const COUNTER_COLORS = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'white', 'gray']);

function removeFromArray<T>(arr: T[], item: T): void {
    const idx = arr.indexOf(item);
    if (idx >= 0) arr.splice(idx, 1);
}

function zoneList(state: GameState, playerId: PlayerId, zone: Zone): CardId[] {
    const p = state.players[playerId];
    if (!p) throw new Error('unknown player');
    switch (zone) {
        case 'library':
            return p.library;
        case 'hand':
            return p.hand;
        case 'battlefield':
            return p.battlefield;
        case 'graveyard':
            return p.graveyard;
        case 'exile':
            return p.exile;
        case 'command':
            return p.command;
        case 'sideboard':
            return p.sideboard;
        case 'stack':
            // global stack not modeled yet
            return p.battlefield;
        default:
            return p.battlefield;
    }
}

function shuffleInPlace<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

export function applyAction(state: GameState, action: GameAction): void {
    switch (action.type) {
        case 'setLife': {
            const p = state.players[action.playerId];
            if (!p) return;
            p.life = Math.max(-999, Math.min(999, Math.trunc(action.life)));
            state.log.push(`${p.name} life -> ${p.life}`);
            break;
        }

        case 'draw': {
            const count = Math.max(1, Math.min(7, action.count ?? 1));
            const p = state.players[action.playerId];
            if (!p) return;
            for (let i = 0; i < count; i++) {
                const top = p.library.shift();
                if (!top) break;
                p.hand.push(top);
                const c = state.cards[top];
                if (c) c.zone = 'hand';
            }
            state.log.push(`${p.name} drew ${count}`);
            break;
        }

        case 'mulligan': {
            const p = state.players[action.playerId];
            if (!p) return;

            // Return hand to library, shuffle, draw 7.
            for (const cid of p.hand) {
                const c = state.cards[cid];
                if (c) {
                    c.zone = 'library';
                    c.tapped = false;
                }
                p.library.push(cid);
            }
            p.hand = [];
            p.mulligans = Math.max(0, Math.min(20, (p.mulligans ?? 0) + 1));

            shuffleInPlace(p.library);
            for (let i = 0; i < 7; i++) {
                const top = p.library.shift();
                if (!top) break;
                p.hand.push(top);
                const c = state.cards[top];
                if (c) c.zone = 'hand';
            }
            state.log.push(`${p.name} mulliganed (${p.mulligans})`);
            break;
        }

        case 'shuffleLibrary': {
            const p = state.players[action.playerId];
            if (!p) return;
            shuffleInPlace(p.library);
            state.log.push(`${p.name} shuffled`);
            break;
        }

        case 'tapToggle': {
            const c = state.cards[action.cardId];
            if (!c) return;
            c.tapped = !c.tapped;
            break;
        }

        case 'card:setPos': {
            const c = state.cards[action.cardId];
            if (!c) return;
            const x = Number(action.x);
            const y = Number(action.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            // Keep reasonable bounds to avoid pathological values.
            c.battlefieldPos = {
                x: Math.max(-5000, Math.min(5000, Math.round(x))),
                y: Math.max(-5000, Math.min(5000, Math.round(y))),
            };
            break;
        }

        case 'turn:setPhase': {
            if (!state.turn) return;
            if (state.turn.activePlayerId !== action.playerId) return;
            state.turn.phase = action.phase;
            const p = state.players[action.playerId];
            state.log.push(`${p?.name ?? 'Player'} → ${action.phase}`);
            break;
        }

        case 'turn:nextPhase': {
            if (!state.turn) return;
            if (state.turn.activePlayerId !== action.playerId) return;
            const idx = PHASES.indexOf(state.turn.phase);
            const next = PHASES[(idx + 1) % PHASES.length];
            state.turn.phase = next;
            const p = state.players[action.playerId];
            state.log.push(`${p?.name ?? 'Player'} → ${next}`);
            break;
        }

        case 'dice:rollD20': {
            const p = state.players[action.playerId];
            if (!p) return;
            const roll = 1 + Math.floor(Math.random() * 20);
            state.log.push(`${p.name} rolled d20: ${roll}`);
            break;
        }

        case 'random:rollDice': {
            const p = state.players[action.playerId];
            if (!p) return;
            const sides = Math.max(2, Math.min(1000, Math.trunc(action.sides)));
            const count = Math.max(1, Math.min(20, Math.trunc(action.count)));
            const modifier = Math.max(-999, Math.min(999, Math.trunc(action.modifier ?? 0)));
            const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
            const total = rolls.reduce((sum, roll) => sum + roll, 0) + modifier;
            const modifierText = modifier === 0 ? '' : modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`;
            state.log.push(`${p.name} rolled ${count}d${sides}${modifierText}: [${rolls.join(', ')}] = ${total}`);
            break;
        }

        case 'random:coinFlip': {
            const p = state.players[action.playerId];
            if (!p) return;
            state.log.push(`${p.name} flipped a coin: ${Math.random() < 0.5 ? 'Heads' : 'Tails'}`);
            break;
        }

        case 'random:number': {
            const p = state.players[action.playerId];
            if (!p) return;
            const rawMin = Math.trunc(action.min);
            const rawMax = Math.trunc(action.max);
            const min = Math.max(-1_000_000, Math.min(rawMin, rawMax));
            const max = Math.min(1_000_000, Math.max(rawMin, rawMax));
            const value = min + Math.floor(Math.random() * (max - min + 1));
            state.log.push(`${p.name} randomized ${min}–${max}: ${value}`);
            break;
        }

        case 'random:choosePlayer': {
            const p = state.players[action.playerId];
            if (!p) return;
            const players = Object.values(state.players);
            if (players.length === 0) return;
            const chosen = players[Math.floor(Math.random() * players.length)];
            state.log.push(`${p.name} chose a random player: ${chosen.name}`);
            break;
        }

        case 'counter:add': {
            const c = state.cards[action.cardId];
            if (!c) return;
            const kind = String(action.kind ?? '').trim();
            if (!kind) return;
            const delta = Math.max(-999, Math.min(999, Math.trunc(action.amount ?? 1)));
            const existing = c.counters.find((x) => x.kind === kind);
            if (existing) {
                existing.amount = Math.max(-999, Math.min(999, existing.amount + delta));
                if (action.color && COUNTER_COLORS.has(action.color)) existing.color = action.color;
            } else {
                c.counters.push({
                    id: nanoid(10),
                    kind,
                    amount: delta,
                    color: action.color && COUNTER_COLORS.has(action.color) ? action.color : undefined,
                });
            }
            break;
        }

        case 'counter:set': {
            const c = state.cards[action.cardId];
            if (!c) return;
            const kind = String(action.kind ?? '').trim();
            if (!kind) return;
            const amount = Math.max(-999, Math.min(999, Math.trunc(action.amount)));
            const existing = c.counters.find((x) => x.kind === kind);
            if (amount === 0) {
                c.counters = c.counters.filter((x) => x.kind !== kind);
            } else if (existing) {
                existing.amount = amount;
            } else {
                c.counters.push({ id: nanoid(10), kind, amount });
            }
            break;
        }

        case 'counter:clear': {
            const c = state.cards[action.cardId];
            if (!c) return;
            c.counters = [];
            break;
        }

        case 'card:setColorTag': {
            const c = state.cards[action.cardId];
            if (!c) return;
            c.colorTag = action.color && CARD_TAG_COLORS.has(action.color) ? action.color : undefined;
            break;
        }

        case 'moveCard': {
            const c = state.cards[action.cardId];
            if (!c) return;

            const fromOwner = c.ownerId;
            // remove from all zones of owner (simple + safe)
            for (const z of ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command', 'sideboard'] as const) {
                removeFromArray(zoneList(state, fromOwner, z), c.id);
            }

            const destOwner = action.toPlayerId ?? c.ownerId;
            c.ownerId = destOwner;
            c.controllerId = destOwner;
            c.zone = action.toZone;
            if (action.toZone !== 'battlefield') c.battlefieldPos = undefined;
            zoneList(state, destOwner, action.toZone).push(c.id);
            break;
        }

        case 'attach': {
            const attachment = state.cards[action.attachmentCardId];
            const target = state.cards[action.targetCardId];
            if (!attachment || !target) return;

            // detach first
            if (attachment.attachedTo) {
                const old = state.cards[attachment.attachedTo];
                if (old) old.attachments = old.attachments.filter((a: Attachment) => a.id !== attachment.id);
            }

            attachment.attachedTo = target.id;
            target.attachments.push({ id: attachment.id, attachedToCardId: target.id });
            break;
        }

        case 'detach': {
            const attachment = state.cards[action.attachmentCardId];
            if (!attachment?.attachedTo) return;
            const target = state.cards[attachment.attachedTo];
            if (target) target.attachments = target.attachments.filter((a: Attachment) => a.id !== attachment.id);
            attachment.attachedTo = undefined;
            break;
        }

        default:
            // exhaustive
            break;
    }

    state.updatedAt = Date.now();
}

export function createPlaceholderCard(ownerId: PlayerId, name: string): CardInstance {
    const id = nanoid(12);
    return {
        id,
        ownerId,
        controllerId: ownerId,
        definition: { name },
        zone: 'library',
        tapped: false,
        counters: [],
        attachments: [],
    };
}
