import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const settle = async () => { for (let index = 0; index < 12; index++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const completeSource = (sourceHash = 'hash-1', projectToken = 'project-a', filePath = 'lean/Main.lean') => ({
    projectToken, projectKey: 'formal', filePath, sourceUri: `${projectToken}:${filePath}`, sourceHash,
    content: 'import Support\nnamespace Demo\n/- outside /- nested -/\n continued -/\ndef «你好» := "a😀\\\"b"\ntheorem sample : True ∧ True := by\n  constructor\n  · exact True.intro\n  · exact True.intro\nend Demo\n',
    lineCount: 11, range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } }, origin: 'project', readonly: true
});
function semanticResponse(source, request, fields = {}) {
    return { projectToken: source.projectToken, projectKey: source.projectKey, filePath: source.filePath, sourceUri: source.sourceUri, sourceHash: source.sourceHash,
        action: request.action, requestId: request.requestId, state: 'available', sessionId: 'session-1', sourceVersion: 1, complete: true,
        capabilities: { hover: true, definition: true, goals: true, diagnostics: true, semanticTokens: true }, ...fields };
}

async function productionModules(directory) {
    const output = path.join(directory, 'production.mjs');
    await build({ stdin: { contents: [
        'reader-lean-source-model', 'reader-lean-source-diff', 'reader-lean-source-highlighter', 'reader-lean-semantic', 'reader-lean-source-editor'
    ].map(name => `export * from ${JSON.stringify(path.join(root, 'src/reader/web', name + '.ts'))};`).join('\n') + '\nexport { EditorState } from "@codemirror/state";', resolveDir: root },
        outfile: output, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
    return import(pathToFileURL(output).href);
}

async function testGrammarPositionsAndExactDiff(module) {
    const source = completeSource().content, syntax = module.tokenizeLeanSource(source);
    const at = value => { const offset = source.indexOf(value); return syntax.find(span => span.from <= offset && span.to > offset); };
    assert.equal(at('nested').className, 'lean-syntax-comment'); assert.equal(at('continued').className, 'lean-syntax-comment');
    assert.equal(at('theorem').className, 'lean-syntax-keyword'); assert.equal(at('你好').className, 'lean-syntax-name');
    assert.equal(at('a😀').className, 'lean-syntax-string'); assert.equal(at('b"').className, 'lean-syntax-string');
    assert.equal(syntax.map(span => source.slice(span.from, span.to)).join(''), source.replaceAll('\n', ''), 'Tokenization preserves every non-newline UTF-16 code unit.');
    const emojiOffset = source.indexOf('😀');
    assert.deepEqual(module.leanOffsetPosition(source, emojiOffset + 2), { line: 4, character: 16 });
    for (const offset of [0, emojiOffset, emojiOffset + 1, emojiOffset + 2, source.length]) assert.equal(module.leanPositionOffset(source, module.leanOffsetPosition(source, offset)), offset);
    const ranges = module.leanFindRanges(source, 'True.intro'); assert.equal(ranges.length, 2);
    assert.equal(module.leanRangeText(source, ranges[1]), 'True.intro');
    assert.equal(module.leanFindRanges(source, '«你好»').length, 1);
    assert.equal(module.leanFindRanges('İi', 'i').length, 1, 'Case-insensitive Unicode search preserves source offsets.');
    const folds = module.leanFoldRanges(source, syntax);
    assert.ok(folds.some(fold => fold.kind === 'section')); assert.ok(folds.some(fold => fold.kind === 'declaration')); assert.ok(folds.some(fold => fold.kind === 'comment'));
    const misleading = '/-\nnamespace Wrong\nend Wrong\n-/\ndef keep := "namespace Wrong"\n';
    assert.equal(module.leanFoldRanges(misleading, module.tokenizeLeanSource(misleading)).some(fold => fold.kind === 'section'), false);
    const before = 'import A\ntheorem t : True := by\n  exact True.intro\n', after = 'import A\ntheorem t : True := by\n  trivial\n';
    const diff = module.leanSourceLineDiff(before, after, 20, 21);
    assert.deepEqual(diff.map(line => [line.kind, line.oldLine, line.newLine]), [['equal', 20, 21], ['equal', 21, 22], ['remove', 22, undefined], ['add', undefined, 23]]);
    const replay = (lines, side) => lines.filter(line => line.kind !== (side === 'old' ? 'add' : 'remove')).map(line => line.text + line.ending).join('');
    for (const [old, next] of [[before, after], ['', 'a\n'], ['a\n', ''], ['a\r\nb\n', 'a\nb'], ['x\nx\ny', 'x\ny\nx'], ['a', 'a\n']]) {
        const result = module.leanSourceLineDiff(old, next); assert.equal(replay(result, 'old'), old); assert.equal(replay(result, 'new'), next);
    }
    const snippet = (content, startLine, filePath) => ({ content, startLine, endLine: startLine + content.split('\n').length - 1, filePath, fingerprint: content });
    const oldStatement = snippet('old statement\nshared\n', 3, 'book/ch01.md'), newStatement = snippet('new statement\nshared\n', 8, 'book/ch01.md');
    const oldProof = snippet('  exact old\n', 21, 'book/proof.md'), newProof = snippet('  exact new\n', 27, 'book/proof.md'), unchanged = snippet('unchanged proof\n', 60, 'book/other.md');
    const oldDeclaration = snippet('theorem t := old\n', 70, 'lean/Book.lean'), newDeclaration = snippet('theorem t := new\n', 76, 'lean/Book.lean');
    const oldEvidence = { statement: oldStatement, proofs: [oldProof, unchanged], contexts: [], declarations: [{ key: 'formal:t', source: oldDeclaration }], definitions: [] };
    const newEvidence = { statement: newStatement, proofs: [newProof, unchanged], contexts: [], declarations: [{ key: 'formal:t', source: newDeclaration }], definitions: [] };
    const joined = sources => sources.map(source => `${source.filePath}:${source.startLine}\n${source.content}`).join('\n\n');
    for (const [kind, previous, current] of [['statement', [oldStatement], [newStatement]], ['proof', [oldProof, unchanged], [newProof, unchanged]]]) {
        const entries = module.leanReviewDiffEntries({ kind, key: kind, label: kind + ' source', previous: joined(previous), current: joined(current) }, oldEvidence, newEvidence);
        assert.equal(entries.length, 1, 'Aggregate changes show only the changed source excerpt.');
        assert.equal(entries[0].previous, previous[0].content); assert.equal(entries[0].current, current[0].content);
        const edits = module.leanSourceLineDiff(entries[0].previous, entries[0].current, entries[0].previousSource.startLine, entries[0].currentSource.startLine);
        assert.equal(edits[0].oldLine, previous[0].startLine); assert.equal(edits.find(line => line.kind === 'add').newLine, current[0].startLine);
        assert.equal(edits.some(line => line.text.includes('.md:')), false, 'Source locator metadata never becomes a code row.');
    }
    const declarationEntries = module.leanReviewDiffEntries({ kind: 'declaration', key: 'formal:t', label: 'formal:t', previous: oldDeclaration.content, current: newDeclaration.content }, oldEvidence, newEvidence);
    assert.equal(declarationEntries[0].previousSource.startLine, 70); assert.equal(declarationEntries[0].currentSource.startLine, 76);
    const draftProofEntries = module.leanReviewDiffEntries({ kind: 'proof', key: 'book/proof.md:0', label: 'book/proof.md:27–28', previous: oldProof.content, current: newProof.content }, oldEvidence, newEvidence);
    assert.equal(draftProofEntries[0].previousSource.startLine, 21); assert.equal(draftProofEntries[0].currentSource.startLine, 27);
    const readonly = module.EditorState.create({ doc: source, extensions: module.leanReadonlyExtensions() });
    assert.equal(readonly.readOnly, true); assert.equal(readonly.update({ changes: { from: 0, insert: 'changed' } }).state.doc.toString(), source, 'Readonly transaction guard rejects edits.');
}

async function testSemanticIdentity(module) {
    const source = completeSource(), context = { projectId: source.projectToken, token: 'token' }, requests = [], events = [];
    let override;
    const host = { context: () => context, request: async (_route, options) => {
        const input = JSON.parse(options.body); requests.push(input);
        if (override) { const value = override(input); if (value) return value; }
        return json(semanticResponse(source, input, input.action === 'goals' ? { goals: ['⊢ True', '⊢ True'] } : input.action === 'hover' ? { hover: { contents: { kind: 'markdown', value: 'True.intro : True' } } } : {}));
    } };
    const first = new module.ReaderLeanSemantic(host, state => events.push(state)), second = new module.ReaderLeanSemantic(host, () => {});
    first.setSource(source); second.setSource(source); await Promise.all([first.open(), second.open()]);
    assert.notEqual(requests.filter(input => input.action === 'open')[0].requestId, requests.filter(input => input.action === 'open')[1].requestId, 'Two Reader instances cannot collide in the backend operation map.');
    first.select({ line: 7, character: 4 }); await wait(150); assert.deepEqual(first.state.goals, ['⊢ True', '⊢ True']); assert.match(module.leanHoverText(first.state.hover.contents), /True.intro/);
    const late = deferred(); override = input => input.action === 'goals' ? late.promise.then(() => json(semanticResponse(source, input, { goals: ['OBSOLETE'] }))) : undefined;
    first.select({ line: 8, character: 4 }); await wait(145); context.projectId = 'project-b'; first.setSource(completeSource('hash-2', 'project-b')); late.resolve(); await settle();
    assert.equal(first.state.state, 'idle'); assert.equal(first.state.goals, undefined);
    assert.ok(requests.some(input => input.action === 'cancel'), 'Closing sends explicit cancellation as well as aborting local requests.');
    context.projectId = source.projectToken; first.setSource(source); override = input => input.action === 'open' ? Promise.resolve(json(semanticResponse(source, input, { complete: undefined }))) : undefined;
    await first.open(); assert.equal(first.state.complete, false, 'Missing completeness cannot become a completed diagnostic claim.');
    const previousCloses = requests.filter(input => input.action === 'close').length;
    override = input => input.action === 'hover' ? Promise.resolve(json(semanticResponse(source, input, { sourceHash: 'wrong' }))) : undefined;
    await first.hoverAt({ line: 0, character: 1 }); assert.equal(first.state.state, 'unavailable'); assert.match(first.state.reason, /source version/);
    assert.equal(first.state.sessionId, undefined); assert.ok(requests.filter(input => input.action === 'close').length > previousCloses, 'A failed session is explicitly retired before retry.');
    first.dispose(); second.dispose();
}

class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.listeners = {}; this.hidden = false; this.className = ''; this.attributes = {}; this._text = ''; this.classList = { add: value => { this.className += ' ' + value; }, toggle: () => {} }; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    append(...values) { values.forEach(value => { value.parent = this; this.children.push(value); }); }
    replaceChildren(...values) { this.children = []; this._text = ''; this.append(...values); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, handler) { this.listeners[key] = handler; }
    scrollIntoView() {}
    querySelectorAll(selector) { const result = []; for (const child of this.children) { if (child.className.split(' ').includes(selector.slice(1))) result.push(child); result.push(...child.querySelectorAll(selector)); } return result; }
}

async function sourceControllerModule(directory) {
    const output = path.join(directory, 'source-controller.mjs');
    // The source owner is real; only the independently browser-tested editor display is replaced.
    // This adapter records selection/layout/destroy and dispatches the same production callbacks.
    await build({ entryPoints: [path.join(root, 'src/reader/web/reader-lean-source.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
        plugins: [{ name: 'display-adapter', setup(builder) {
            builder.onResolve({ filter: /reader-lean-source-editor$/ }, () => ({ path: 'source-display', namespace: 'adapter' }));
            builder.onLoad({ filter: /.*/, namespace: 'adapter' }, () => ({ contents: `export class LeanSourceEditor {
                constructor(parent,content,host){this.parent=parent;this.content=content;this.host=host;this.focusCount=0;this.scrollTop=0;parent.editor=this;}
                focusRange(range){this.range=range;this.focusCount++;this.host.positionChanged(range.start,range);}
                focusPosition(position){this.focusRange({start:position,end:position});}
                setSyntax(value){this.syntax=value;} setSemantics(tokens,diagnostics){this.tokens=tokens;this.diagnostics=diagnostics;}
                refreshLayout(){} setLanguage(language){this.language=language;} find(){} fold(){} unfold(){} destroy(){this.destroyed=true;}
            }` }));
        } }] });
    return import(pathToFileURL(output).href);
}

async function testFullSourceLifecycle(directory) {
    const savedDocument = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
    try {
        const { ReaderLeanSource } = await sourceControllerModule(directory), context = { projectId: 'project-a', token: 'token', language: 'en', revision: 1 };
        let source = completeSource(), delayed; const selected = [], requests = [];
        const host = { context: () => context, report() {}, selectionChanged: value => selected.push(value), request: async (route, options) => {
            requests.push({ route, options });
            if (route.startsWith('/api/lean-language/source')) return delayed ? delayed.promise : json(source);
            const input = JSON.parse(options.body); return json(semanticResponse(source, input, { state: 'unavailable', reason: 'toolchain absent' }));
        } };
        const viewer = new ReaderLeanSource(host); viewer.bindObject('formal-1');
        const target = { projectKey: 'formal', filePath: source.filePath, range: { start: { line: 5, character: 0 }, end: { line: 8, character: 19 } } };
        await viewer.open(target); const editor = viewer.editor; assert.ok(editor); assert.equal(editor.content, source.content);
        assert.equal(requests.filter(request => request.options.method === 'POST').length, 0, 'Full file reading never starts Lean automatically.');
        const proofRange = { start: { line: 7, character: 4 }, end: { line: 7, character: 20 } }; editor.focusRange(proofRange); editor.scrollTop = 123;
        const focusCount = editor.focusCount; context.revision++; viewer.contextChanged(); await settle();
        assert.equal(viewer.editor, editor); assert.equal(editor.focusCount, focusCount); assert.equal(editor.scrollTop, 123); assert.deepEqual(viewer.currentSelection().range, proofRange);
        await viewer.semantic.open(); assert.equal(viewer.semantic.state.state, 'unavailable'); assert.equal(viewer.editor.content, source.content); assert.match(viewer.mount().textContent, /Complete source remains readable/);
        source = { ...source, sourceHash: 'new-hash', content: '\n' + source.content, lineCount: 12 }; context.revision++; viewer.contextChanged(); await settle();
        assert.equal(viewer.currentSelection(), undefined, 'Changed source cannot retain old selected coordinates.'); assert.equal(viewer.linkedRange, undefined); assert.match(viewer.mount().textContent, /Source changed/);
        delayed = deferred(); const opening = viewer.open({ projectKey: 'formal', filePath: 'lean/Other.lean' });
        context.projectId = 'project-b'; viewer.bindObject('formal-1'); delayed.resolve(json(completeSource('late-hash', 'project-a', 'lean/Other.lean'))); await opening;
        assert.equal(viewer.mount().hidden, true); assert.equal(viewer.currentSelection(), undefined);
        viewer.dispose();
    } finally { globalThis.document = savedDocument; }
}

export async function testReaderLeanSource() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-source-tests-'));
    try { const modules = await productionModules(directory); await testGrammarPositionsAndExactDiff(modules); await testSemanticIdentity(modules); await testFullSourceLifecycle(directory); }
    finally { await fs.rm(directory, { recursive: true, force: true }); }
    console.log('Readonly Lean source, grammar, exact diff and semantic lifecycle tests passed.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testReaderLeanSource();
