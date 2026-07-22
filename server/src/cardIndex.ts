import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArenaDeckLine, CardDefinition } from '@mtg-online/shared';

export type IndexEntry = {
    name: string;
    scryfallId: string;
    scryfallOracleId?: string;
};

export type CardIndex = {
    bySetAndNumber: Record<string, Record<string, IndexEntry>>;
    byName: Record<string, IndexEntry>;
    meta?: {
        builtAt?: string;
        sets?: number;
        cards?: number;
    };
};

function normalizeName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[’]/g, "'")
        .replace(/\s+/g, ' ');
}

function normalizeCollectorNumber(n: string): string {
    return n.trim().toUpperCase();
}

function normalizeSetCode(setCode: string): string {
    return setCode.trim().toUpperCase();
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultIndexPath = path.join(serverRoot, 'data', 'card-index.json');

let cached: CardIndex | null = null;

export function loadCardIndex(indexPath = defaultIndexPath): CardIndex | null {
    if (cached) return cached;
    if (!fs.existsSync(indexPath)) return null;
    const raw = fs.readFileSync(indexPath, 'utf-8');
    cached = JSON.parse(raw) as CardIndex;
    return cached;
}

export function resolveFromArenaLine(index: CardIndex | null, line: ArenaDeckLine): CardDefinition {
    const name = line.name.trim();

    if (!index) return { name };

    if (line.setCode && line.collectorNumber) {
        const set = index.bySetAndNumber[normalizeSetCode(line.setCode)];
        const entry = set?.[normalizeCollectorNumber(line.collectorNumber)];
        if (entry) {
            return {
                name: entry.name,
                scryfallId: entry.scryfallId,
                scryfallOracleId: entry.scryfallOracleId,
            };
        }
    }

    const entry = index.byName[normalizeName(name)];
    if (entry) {
        return {
            name: entry.name,
            scryfallId: entry.scryfallId,
            scryfallOracleId: entry.scryfallOracleId,
        };
    }

    return { name };
}
