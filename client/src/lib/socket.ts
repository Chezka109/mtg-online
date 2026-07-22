import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@mtg-online/shared';

export type MtgSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createMtgSocket(serverUrl: string): MtgSocket {
    return io(serverUrl, {
        withCredentials: true,
        timeout: 5000,
        transports: ['websocket', 'polling'],
    });
}
