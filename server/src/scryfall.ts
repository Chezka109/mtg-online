import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LRUCache } from 'lru-cache';

export type ScryfallImageData = {
    imageUrl?: string;
    faces?: Array<{ name: string; imageUrl?: string }>;
    typeLine?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const diskDir = path.join(serverRoot, '.cache', 'scryfall');

const mem = new LRUCache<string, ScryfallImageData>({
    max: 5000,
    ttl: 1000 * 60 * 60 * 24 * 7,
});

const inflight = new Map<string, Promise<ScryfallImageData>>();

function diskPath(id: string): string {
    return path.join(diskDir, `${id}.json`);
}

function parseImageData(cardJson: any): ScryfallImageData {
    const imageUrl = cardJson?.image_uris?.normal;
    const typeLine = typeof cardJson?.type_line === 'string' ? cardJson.type_line : undefined;
    const faces = Array.isArray(cardJson?.card_faces)
        ? cardJson.card_faces.map((f: any) => ({
            name: String(f?.name ?? ''),
            imageUrl: f?.image_uris?.normal,
        }))
        : undefined;
    return { imageUrl: typeof imageUrl === 'string' ? imageUrl : undefined, faces, typeLine };
}

async function readDisk(id: string): Promise<any | null> {
    const p = diskPath(id);
    if (!fs.existsSync(p)) return null;
    try {
        const raw = await fs.promises.readFile(p, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function writeDisk(id: string, json: any): Promise<void> {
    fs.mkdirSync(diskDir, { recursive: true });
    await fs.promises.writeFile(diskPath(id), JSON.stringify(json));
}

export async function getScryfallImageData(scryfallId: string): Promise<ScryfallImageData> {
    const id = scryfallId.trim();
    if (!id) return {};

    const cached = mem.get(id);
    if (cached) return cached;

    const existing = inflight.get(id);
    if (existing) return existing;

    const p = (async () => {
        const fromDisk = await readDisk(id);
        if (fromDisk) {
            const data = parseImageData(fromDisk);
            mem.set(id, data);
            return data;
        }

        const url = `https://api.scryfall.com/cards/${encodeURIComponent(id)}`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'mtg-online (local dev)',
                Accept: 'application/json',
            },
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Scryfall ${res.status}: ${text.slice(0, 200)}`);
        }

        const json = await res.json();
        await writeDisk(id, json);

        const data = parseImageData(json);
        mem.set(id, data);
        return data;
    })()
        .finally(() => {
            inflight.delete(id);
        });

    inflight.set(id, p);
    return p;
}
