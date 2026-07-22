import fs from 'node:fs';
import path from 'node:path';

import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/pick.js';
import { streamObject } from 'stream-json/streamers/stream-object.js';

function normalizeName(name) {
    return String(name)
        .trim()
        .toLowerCase()
        .replace(/[’]/g, "'")
        .replace(/\s+/g, ' ');
}

function normalizeCollectorNumber(n) {
    return String(n).trim().toUpperCase();
}

async function main() {
    const repoRoot = path.resolve(import.meta.dirname, '..', '..');
    const inputPath = process.argv[2]
        ? path.resolve(process.argv[2])
        : path.join(repoRoot, 'AllPrintings.json');
    const outPath = path.join(repoRoot, 'server', 'data', 'card-index.json');

    if (!fs.existsSync(inputPath)) {
        console.error(`Input not found: ${inputPath}`);
        process.exit(1);
    }

    const index = {
        bySetAndNumber: {},
        byName: {},
        meta: { builtAt: new Date().toISOString(), sets: 0, cards: 0 },
    };

    let sets = 0;
    let cards = 0;

    const stream = chain([
        fs.createReadStream(inputPath, { encoding: 'utf-8' }),
        parser(),
        pick({ filter: 'data' }),
        streamObject(),
    ]);

    for await (const chunk of stream) {
        const setCode = String(chunk.key);
        const setObj = chunk.value;
        const setCards = Array.isArray(setObj?.cards) ? setObj.cards : [];

        sets++;
        if (!index.bySetAndNumber[setCode]) index.bySetAndNumber[setCode] = {};

        for (const c of setCards) {
            const name = c?.name;
            const number = c?.number;
            const ids = c?.identifiers;
            const scryfallId = ids?.scryfallId;
            const scryfallOracleId = ids?.scryfallOracleId;
            if (!name || !number || !scryfallId) continue;

            const entry = { name, scryfallId, scryfallOracleId };
            index.bySetAndNumber[setCode][normalizeCollectorNumber(number)] = entry;

            const key = normalizeName(name);
            if (!index.byName[key]) index.byName[key] = entry;

            cards++;
        }
    }

    index.meta.sets = sets;
    index.meta.cards = cards;

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(index));

    console.log(`Wrote ${outPath}`);
    console.log(`Sets: ${sets}, indexed cards: ${cards}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
