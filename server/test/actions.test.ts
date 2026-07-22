import assert from 'node:assert/strict';
import test from 'node:test';

import type { GameState } from '@mtg-online/shared';
import { applyAction, createPlaceholderCard } from '../src/actions.js';
import { addOrReconnectPlayer, createRoom } from '../src/state.js';

function table(): GameState {
    const room = createRoom('TEST', { id: 'one', name: 'One' }, 'standard');
    addOrReconnectPlayer(room, { id: 'two', name: 'Two' });
    return room.state;
}

test('moves cards between modeled zones without duplicating them', () => {
    const state = table();
    const card = createPlaceholderCard('one', 'Forest');
    state.cards[card.id] = card;
    state.players.one.library.push(card.id);

    applyAction(state, { type: 'moveCard', cardId: card.id, toZone: 'battlefield' });
    applyAction(state, { type: 'card:setPos', cardId: card.id, x: 120, y: 80 });

    assert.equal(state.players.one.library.includes(card.id), false);
    assert.deepEqual(state.players.one.battlefield, [card.id]);
    assert.equal(card.zone, 'battlefield');
    assert.deepEqual(card.battlefieldPos, { x: 120, y: 80 });
});

test('advancing past ending starts the next player turn', () => {
    const state = table();
    state.turn!.phase = 'ending';

    applyAction(state, { type: 'turn:nextPhase', playerId: 'one' });

    assert.deepEqual(state.turn, { activePlayerId: 'two', number: 2, phase: 'beginning' });
    assert.equal(state.log.at(-1), 'Turn 2 → Two');
});

test('stores color-customized counters and card border tags', () => {
    const state = table();
    const card = createPlaceholderCard('one', 'Test permanent');
    state.cards[card.id] = card;

    applyAction(state, { type: 'counter:add', cardId: card.id, kind: 'Charge', amount: 3, color: 'blue' });
    applyAction(state, { type: 'card:setColorTag', cardId: card.id, color: 'purple' });

    assert.deepEqual(card.counters.map(({ kind, amount, color }) => ({ kind, amount, color })), [
        { kind: 'Charge', amount: 3, color: 'blue' },
    ]);
    assert.equal(card.colorTag, 'purple');
});

test('randomizers produce bounded authoritative log results', () => {
    const state = table();

    applyAction(state, { type: 'random:rollDice', playerId: 'one', sides: 6, count: 2, modifier: 1 });
    assert.match(state.log.at(-1) ?? '', /^One rolled 2d6 \+ 1: \[[1-6], [1-6]\] = \d+$/);

    applyAction(state, { type: 'random:number', playerId: 'one', min: 9, max: 4 });
    const value = Number(state.log.at(-1)?.split(': ').at(-1));
    assert.ok(value >= 4 && value <= 9);

    applyAction(state, { type: 'random:coinFlip', playerId: 'one' });
    assert.match(state.log.at(-1) ?? '', /^One flipped a coin: (Heads|Tails)$/);
});
