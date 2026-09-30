import { isReaderApp, readerHostFetch, readerHostEvents, type ReaderEvents } from './reader-host';

export function readerRoute(route: string): string { return route; }
export function isReaderEmbedded(): boolean { return isReaderApp(); }
export function readerFetch(route: string, options?: RequestInit): Promise<Response> {
    return isReaderApp() ? readerHostFetch(route, options) : fetch(route, options);
}
export function readerEvents(): ReaderEvents {
    return isReaderApp() ? readerHostEvents() : new EventSource('/api/events');
}
