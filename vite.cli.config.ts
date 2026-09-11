import * as path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
    resolve: {
        alias: [
            {
                find: '@math-workspace/core',
                replacement: path.resolve(__dirname, 'packages/core/src/formal-core.ts')
            }
        ]
    },
    build: {
        outDir: 'out/cli',
        emptyOutDir: false,
        target: 'es2022',
        sourcemap: false,
        minify: false,
        lib: {
            entry: {
                'math-workspace': 'src/cli/math-workspace.ts',
                release: 'src/cli/release.ts',
                archive: 'src/archive/index.ts'
            },
            formats: ['cjs'],
            fileName: (_format, entryName) => `${entryName}.js`
        },
        rollupOptions: {
            external: [/^node:/]
        }
    }
});
