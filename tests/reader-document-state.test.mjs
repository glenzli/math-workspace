import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = path.resolve(new URL('..', import.meta.url).pathname);

export async function testReaderDocumentState() {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-document-state-'));
    try {
        await build({ entryPoints: [path.join(root, 'src/reader/document-state.ts')], outfile: path.join(temporary, 'state.cjs'), tsconfig: path.join(root, 'tsconfig.cli.json'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
        const { readDocumentState: read, updateDocumentState: update } = require(path.join(temporary, 'state.cjs'));
        const filePath = 'book/chapter.md', original = '# Confirmed\n\n稳定内容。\n', revised = original + '\nNew text.\n';
        const documents = new Map([[filePath, original]]), config = {};
        const stateFile = path.join(temporary, '.math-workspace/documents.json');
        const save = change => update(temporary, config, documents, { filePath, ...change });
        assert.equal((await read(temporary, config, documents)).lifecycles[filePath].stage, 'draft');
        let state = await save({ stage: 'stable' });
        assert.match(state.records[filePath].stableContentHash, /^[a-f0-9]{64}$/);
        const stableHash = state.records[filePath].stableContentHash;
        const savedBytes = await fs.readFile(stateFile, 'utf8');
        documents.set(filePath, revised);
        state = await read(temporary, config, documents);
        assert.equal(state.lifecycles[filePath].stage, 'revising');
        assert.equal(state.lifecycles[filePath].changedSinceStable, true);
        assert.equal(state.records[filePath].stage, 'stable', 'Automatic presentation preserves the explicit confirmation record.');
        assert.equal(await fs.readFile(stateFile, 'utf8'), savedBytes, 'Reading changed prose never writes document metadata.');
        state = await save({ checkpointLabel: 'RC2' });
        assert.equal(state.lifecycles[filePath].stage, 'revising');
        assert.equal(state.lifecycles[filePath].changedSinceCheckpoint, false);
        assert.equal(state.records[filePath].stableContentHash, stableHash, 'A milestone does not reconfirm the stable draft.');
        state = await save({ clearCheckpoint: true });
        assert.equal(state.lifecycles[filePath].stage, 'revising');
        assert.equal(state.records[filePath].stableContentHash, stableHash);
        documents.set(filePath, original);
        assert.equal((await read(temporary, config, documents)).lifecycles[filePath].stage, 'stable', 'Restoring confirmed bytes restores the stage.');
        documents.set(filePath, revised);
        state = await save({ stage: 'stable' });
        assert.equal(state.lifecycles[filePath].stage, 'stable');
        assert.notEqual(state.records[filePath].stableContentHash, stableHash, 'Explicit reconfirmation binds to the revised content.');
        state = await save({ stage: 'revising' });
        assert.equal(state.records[filePath].stableContentHash, undefined);
        documents.set(filePath, original);
        assert.equal((await read(temporary, config, documents)).lifecycles[filePath].stage, 'revising', 'An explicit revising stage is not undone by restoring older content.');
        await fs.writeFile(stateFile, JSON.stringify({ schemaVersion: 1, documents: { [filePath]: { stage: 'stable' } } }));
        state = await read(temporary, config, documents);
        assert.equal(state.lifecycles[filePath].stage, 'stable');
        assert.equal(state.records[filePath].stableContentHash, undefined, 'Legacy records never silently adopt current prose as a stable baseline.');
        const draftConfig = { documents: { collections: [{ id: 'ideas', mode: 'draft', include: ['book/**'] }] } };
        assert.equal((await read(temporary, draftConfig, documents)).lifecycles[filePath].stage, undefined);
        await assert.rejects(update(temporary, draftConfig, documents, { filePath, stage: 'stable' }), /Draft collections/);
        console.log('Reader document stages: explicit content baseline, derived revising, restoration, milestone independence, read-only projection and legacy records passed.');
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) await testReaderDocumentState();
