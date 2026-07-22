import type { ArenaDeckImport, ArenaDeckLine, ArenaDeckSection } from '@mtg-online/shared';

const SECTION_HEADERS: Record<string, ArenaDeckSection> = {
    sideboard: 'sideboard',
    commander: 'commander',
};

// MTG Arena examples:
// 4 Lightning Strike (XLN) 149
// 1 Sheoldred, the Apocalypse (DMU) 107
// 
// Sideboard
// 2 Duress (MID) 98
export function parseArenaDeck(text: string): { ok: true; deck: ArenaDeckImport } | { ok: false; error: string } {
    const lines = text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    if (lines.length === 0) return { ok: false, error: 'Paste an Arena deck list.' };

    let section: ArenaDeckSection = 'main';
    const out: ArenaDeckLine[] = [];

    for (const raw of lines) {
        const header = raw.toLowerCase();
        if (header in SECTION_HEADERS) {
            section = SECTION_HEADERS[header];
            continue;
        }

        // ignore headings like "Deck" / "Companion" / etc.
        if (['deck', 'companion'].includes(header)) continue;

        // quantity + rest
        const m = raw.match(/^(\d+)\s+(.+)$/);
        if (!m) continue;
        const quantity = Number(m[1]);
        const rest = m[2];

        const m2 = rest.match(/^(.*?)\s*\(([^)]+)\)\s*(\S+)?$/);
        if (m2) {
            const name = m2[1].trim();
            const setCode = m2[2].trim();
            const collectorNumber = (m2[3] ?? '').trim() || undefined;
            out.push({ section, quantity, name, setCode, collectorNumber });
        } else {
            out.push({ section, quantity, name: rest.trim() });
        }
    }

    if (out.length === 0) return { ok: false, error: 'No cards found in deck list.' };
    return { ok: true, deck: { lines: out } };
}
