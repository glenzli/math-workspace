declare module '*.png' {
    const source: string;
    export default source;
}

declare module 'fs' {
    export const existsSync: any;
    export const readFileSync: any;
    export const appendFileSync: any;
    export const promises: any;
    export const mkdirSync: any;
}

declare module 'node:fs/promises' {
    export const realpath: any;
    export const access: any;
    export const copyFile: any;
    export const mkdir: any;
    export const readFile: any;
    export const readdir: any;
    export const rm: any;
    export const stat: any;
    export const writeFile: any;
}

declare module 'node:fs' {
    export const watch: any;
    export const createReadStream: any;
    export const existsSync: any;
}

declare module 'node:http' {
    export const createServer: any;
}

declare module 'path' {
    export const join: any;
    export const basename: any;
    export const extname: any;
    export const dirname: any;
    export const relative: any;
}

declare module 'node:path' {
    export const basename: any;
    export const dirname: any;
    export const extname: any;
    export const isAbsolute: any;
    export const join: any;
    export const posix: any;
    export const relative: any;
    export const resolve: any;
    export const sep: any;
}

declare module 'node:crypto' {
    export const createHash: any;
    export const randomBytes: any;
}

declare const require: (module: string) => any;
declare const __dirname: string;
declare const Buffer: any;
declare function setTimeout(callback: (...args: any[]) => void, delay?: number): any;
declare function clearTimeout(handle?: any): void;
declare const process: any;
declare const console: {
    log: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
};
