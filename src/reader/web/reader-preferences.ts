import { readerHostPreferenceStorage, subscribeReaderHostContext } from './reader-host';

export type ReaderLanguage = 'zh' | 'en';
export type ReaderTheme = 'light' | 'dark';
export type LanguagePreference = 'auto' | ReaderLanguage;
export type ThemePreference = 'auto' | ReaderTheme;
export interface ReaderPreferenceSnapshot {
    language: ReaderLanguage;
    theme: ReaderTheme;
    languagePreference: LanguagePreference;
    themePreference: ThemePreference;
}
type StoredPreferences = { language: LanguagePreference; theme: ThemePreference };
type StorageChange = { key: string | null; newValue: string | null; storageArea?: unknown };
export interface ReaderPreferenceEnvironment {
    languages?: () => readonly unknown[];
    systemTheme?: () => ReaderTheme;
    storage?: Pick<Storage, 'getItem' | 'setItem'>;
    fallbackStorage?: Pick<Storage, 'getItem' | 'setItem'>;
    root?: { lang?: string; setAttribute?: (name: string, value: string) => void; style?: { colorScheme: string } };
    onLanguageChange?: (listener: () => void) => () => void;
    onSystemThemeChange?: (listener: () => void) => () => void;
    onStorageChange?: (listener: (event: StorageChange) => void) => () => void;
}

export const READER_PREFERENCES_STORAGE_KEY = 'math-workspace.reader.preferences.v1';
function languagePreference(value: unknown): value is LanguagePreference { return value === 'auto' || value === 'zh' || value === 'en'; }
function themePreference(value: unknown): value is ThemePreference { return value === 'auto' || value === 'light' || value === 'dark'; }
function storedPreferences(raw: string | null): StoredPreferences {
    try {
        const value = raw ? JSON.parse(raw) : undefined;
        return { language: languagePreference(value?.language) ? value.language : 'auto',
            theme: themePreference(value?.theme) ? value.theme : 'auto' };
    } catch { return { language: 'auto', theme: 'auto' }; }
}
function supportedLanguage(locale: unknown): ReaderLanguage | undefined {
    if (typeof locale !== 'string') return;
    const language = locale.trim().toLowerCase().split('-')[0];
    if (language === 'zh' || language === 'en') return language;
}

export class ReaderPreferences {
    private preferences: StoredPreferences;
    private hostLocale: string | undefined;
    private hostTheme: ReaderTheme | undefined;
    private current: ReaderPreferenceSnapshot;
    private listeners = new Set<(snapshot: ReaderPreferenceSnapshot) => void>();
    private cleanups: (() => void)[] = [];
    private storageBlocked = false;
    private fallbackStorageBlocked = false;

    constructor(private environment: ReaderPreferenceEnvironment = {}) {
        this.preferences = this.readStorage() || { language: 'auto', theme: 'auto' };
        this.current = this.resolve();
        this.applyDocument();
        const refresh = () => this.refresh();
        if (environment.onLanguageChange) this.cleanups.push(environment.onLanguageChange(refresh));
        if (environment.onSystemThemeChange) this.cleanups.push(environment.onSystemThemeChange(refresh));
        if (environment.onStorageChange) this.cleanups.push(environment.onStorageChange(event => {
            if (event.key !== null && event.key !== READER_PREFERENCES_STORAGE_KEY) return;
            if (event.storageArea && event.storageArea !== environment.storage) return;
            if (this.storageBlocked && environment.fallbackStorage) return;
            this.preferences = this.readStorage() || storedPreferences(event.newValue);
            this.refresh();
        }));
    }

    snapshot(): ReaderPreferenceSnapshot { return { ...this.current }; }
    setLanguage(value: LanguagePreference): void {
        if (languagePreference(value)) this.setPreference({ language: value });
    }
    setTheme(value: ThemePreference): void {
        if (themePreference(value)) this.setPreference({ theme: value });
    }
    subscribe(listener: (snapshot: ReaderPreferenceSnapshot) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    updateHostContext(context: unknown): void {
        if (!context || typeof context !== 'object' || Array.isArray(context)) return;
        const patch = context as Record<string, unknown>;
        if (typeof patch.locale === 'string' && patch.locale.trim()) this.hostLocale = patch.locale;
        if (patch.theme === 'light' || patch.theme === 'dark') this.hostTheme = patch.theme;
        this.refresh();
    }
    dispose(): void { this.cleanups.splice(0).forEach(cleanup => cleanup()); this.listeners.clear(); }

    private readStorage(): StoredPreferences | undefined {
        if (!this.storageBlocked && this.environment.storage) {
            try {
                const raw = this.environment.storage.getItem(READER_PREFERENCES_STORAGE_KEY);
                if (raw !== null) return storedPreferences(raw);
                // A previous write denial may have saved this panel through the host bridge.
                const fallback = this.readFallbackStorage();
                if (fallback !== undefined) { this.storageBlocked = true; return fallback; }
                return storedPreferences(null);
            }
            catch { this.storageBlocked = true; }
        }
        return this.readFallbackStorage();
    }
    private readFallbackStorage(): StoredPreferences | undefined {
        if (!this.fallbackStorageBlocked && this.environment.fallbackStorage) {
            try {
                const raw = this.environment.fallbackStorage.getItem(READER_PREFERENCES_STORAGE_KEY);
                if (raw !== null) return storedPreferences(raw);
            }
            catch { this.fallbackStorageBlocked = true; }
        }
    }
    private setPreference(patch: Partial<StoredPreferences>): void {
        // Read before merging so another view's unobserved preference change is preserved.
        this.preferences = { ...(this.readStorage() || this.preferences), ...patch };
        const value = JSON.stringify(this.preferences);
        let persisted = false;
        if (!this.storageBlocked && this.environment.storage) {
            try { this.environment.storage.setItem(READER_PREFERENCES_STORAGE_KEY, value); persisted = true; }
            catch { this.storageBlocked = true; }
        }
        if (!persisted && !this.fallbackStorageBlocked && this.environment.fallbackStorage) {
            try { this.environment.fallbackStorage.setItem(READER_PREFERENCES_STORAGE_KEY, value); }
            catch { this.fallbackStorageBlocked = true; }
        }
        this.refresh();
    }
    private resolve(): ReaderPreferenceSnapshot {
        let browserLanguage: ReaderLanguage | undefined;
        for (const locale of this.environment.languages?.() || []) {
            browserLanguage = supportedLanguage(locale);
            if (browserLanguage) break;
        }
        return { languagePreference: this.preferences.language, themePreference: this.preferences.theme,
            language: this.preferences.language === 'auto' ? supportedLanguage(this.hostLocale) || browserLanguage || 'en' : this.preferences.language,
            theme: this.preferences.theme === 'auto' ? this.hostTheme || this.environment.systemTheme?.() || 'light' : this.preferences.theme };
    }
    private applyDocument(): void {
        const root = this.environment.root;
        if (!root) return;
        root.lang = this.current.language;
        root.setAttribute?.('data-reader-theme', this.current.theme);
        if (root.style) root.style.colorScheme = this.current.theme;
    }
    private refresh(): void {
        const next = this.resolve();
        if (next.language === this.current.language && next.theme === this.current.theme
            && next.languagePreference === this.current.languagePreference && next.themePreference === this.current.themePreference) return;
        this.current = next;
        this.applyDocument();
        this.listeners.forEach(listener => listener(this.snapshot()));
    }
}

function browserEnvironment(): ReaderPreferenceEnvironment {
    const browser = typeof window === 'undefined' ? undefined : window;
    const languages = () => typeof navigator === 'undefined' ? [] : [...(navigator.languages || []), navigator.language];
    let storage: ReaderPreferenceEnvironment['storage'];
    let media: MediaQueryList | undefined;
    try { storage = browser?.localStorage; } catch { /* Sandboxed hosts may deny storage access. */ }
    try { media = browser?.matchMedia?.('(prefers-color-scheme: dark)'); } catch { /* Use light when media queries are unavailable. */ }
    const listen = (type: string, listener: EventListener): (() => void) => {
        browser?.addEventListener?.(type, listener);
        return () => browser?.removeEventListener?.(type, listener);
    };
    return { storage, fallbackStorage: readerHostPreferenceStorage(), languages, systemTheme: () => media?.matches ? 'dark' : 'light',
        root: typeof document === 'undefined' ? undefined : document.documentElement,
        onLanguageChange: listener => listen('languagechange', listener),
        onStorageChange: listener => listen('storage', event => listener(event as StorageEvent)),
        onSystemThemeChange: listener => {
            if (media?.addEventListener) {
                media.addEventListener('change', listener);
                return () => media?.removeEventListener('change', listener);
            }
            media?.addListener?.(listener);
            return () => media?.removeListener?.(listener);
        } };
}

export const readerPreferences = new ReaderPreferences(browserEnvironment());
export function updateReaderHostContext(context: unknown): void { readerPreferences.updateHostContext(context); }
subscribeReaderHostContext(updateReaderHostContext);
