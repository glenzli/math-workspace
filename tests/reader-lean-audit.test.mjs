import { readerUiLabels, installReaderTextNodes } from './reader-ui-harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const require = createRequire(import.meta.url);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = 'h-aaaaaaaaaaaaaaaa', B = 'h-bbbbbbbbbbbbbbbb', project = 'a'.repeat(64), fingerprint = 'f'.repeat(64);
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const deferred = () => { let resolve; const promise = new Promise(yes => resolve = yes); return { promise, resolve }; };
async function settle() { for (let index = 0; index < 16; index++) await new Promise(resolve => setImmediate(resolve)); }
function payload(id = A) {
    const filePath = id === A ? 'book/one.md' : 'other/two.md';
    const prose = { filePath, startLine: 3, endLine: 3, content: '定理 😀：a certificate can be constructed.', role: 'statement', fingerprint };
    const lean = { filePath: 'lean/Book.lean', startLine: 8, endLine: 8, content: 'theorem certificate_input : Claim n := certificate.proof', role: 'declaration', fingerprint };
    return { id, projectToken: project, evidenceFingerprint: fingerprint, expectedRevision: 0, links: [], issues: [],
        proseSources: [{ key: `${filePath}:3:3:statement`, source: prose, fileHash: '1'.repeat(64) }],
        leanSources: [{ key: 'formal:Book.certificate_input', declarationKey: 'formal:Book.certificate_input', projectKey: 'formal', source: lean, fileHash: '2'.repeat(64) }],
        manualReview: { freshness: 'current', verdict: 'partial', historyDropped: 0, history: [{ revision: 1, verdict: 'partial', scope: 'Only the supplied certificate.', note: 'Construction remains open.', reviewer: 'Author',
            reviewedAt: '2026-10-12T00:00:00Z', evidenceFingerprint: fingerprint, subclaims: [{ id: 'construction', text: 'Construct a certificate.', note: '', verdict: 'undecided', declarationKeys: [] }] }] }, warnings: [] };
}
function review(value) { return { id: value.id, projectToken: value.projectToken, evidence: { fingerprint: value.evidenceFingerprint }, review: { expectedRevision: value.manualReview.history.at(-1)?.revision || 0 } }; }
class Element {
    constructor(tag, document) { this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; this.className = ''; this.value = ''; this._text = ''; this.hidden = false; this.selectionStart = 0; this.selectionEnd = 0;
        this.classList = { add: (...names) => { this.className = [this.className, ...names].filter(Boolean).join(' '); } }; }
    get parentElement() { return this.parent; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    append(...children) { for (const child of children) { child.remove?.(); child.parent = this; this.children.push(child); } }
    appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) { for (const child of this.children) child.parent = undefined; this.children = []; this._text = ''; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return name.startsWith('data-') ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] ?? null : this.attributes.get(name) ?? null; }
    matches(selector) {
        const tag = selector.match(/^[a-z][\w-]*/i)?.[0]; if (tag && this.tagName !== tag.toUpperCase()) return false;
        for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!this.className.split(' ').includes(name)) return false;
        for (const [, name, , value] of selector.matchAll(/\[([\w-]+)(?:=(["'])(.*?)\2)?\]/g)) { const found = this.getAttribute(name); if (found === null || (value !== undefined && found !== value)) return false; }
        return true;
    }
    querySelectorAll(selector) { const matches = []; const visit = element => { for (const child of element.children) { if (child.matches(selector)) matches.push(child); visit(child); } }; visit(this); return matches; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, callback) { const handlers = this.listeners.get(type) || []; handlers.push(callback); this.listeners.set(type, handlers); }
    emit(type) { for (const handler of this.listeners.get(type) || []) handler({ type, target: this }); }
    click() { if (!this.disabled) this.emit('click'); }
    focus() { this.ownerDocument.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}
installReaderTextNodes(Element);

async function harness() {
    const document = { createElement(tag) { return new Element(tag, this); }, createElementNS(_namespace, tag) { return this.createElement(tag); } }; document.body = new Element('body', document);
    const context = { projectId: project, requestToken: 'local-token', language: 'zh', revision: 1 };
    const stores = new Map([[A, payload(A)], [B, payload(B)]]), requests = [], reports = [], opened = [], proseJumps = [], codeJumps = [], assists = [], downloads = [], copied = [];
    let override, count = 0;
    const request = async (route, options = {}) => {
        requests.push({ route, options: structuredClone(options) }); if (override) { const result = override(route, options); if (result) return result; }
        assert.equal(options.headers['x-math-workspace-token'], 'local-token'); assert.equal(options.headers['x-math-workspace-project'], project);
        const url = new URL(route, 'http://local');
        if (url.pathname === '/api/lean-audit') return response(stores.get(url.searchParams.get('id')));
        if (url.pathname === '/api/lean-audit/overview') return response({ projectToken: project, generatedAt: '2026-10-12T00:00:00Z', complete: true,
            items: [...stores.values()].map(value => ({ id: value.id, display: 'Theorem', title: value.id === A ? 'One' : 'Two', filePath: value.proseSources[0].source.filePath, line: 3,
                reviewFreshness: value.manualReview.freshness, unresolvedIssues: value.issues.filter(issue => issue.unresolved).length, staleLinks: 0, staleIssues: 0 })),
            counts: { total: 2, pending: 0, stale: 0, unresolvedIssues: 1 }, orphaned: [] });
        if (url.pathname === '/api/lean-audit/report') return response({ projectToken: project, generatedAt: '2026-10-12T00:00:00Z', format: 'markdown', content: '# Current human audit report\n' });
        if (url.pathname !== '/api/lean-audit/action') throw new Error('Unexpected route ' + route);
        const body = JSON.parse(options.body), current = stores.get(body.id);
        if (body.expectedRevision !== current.expectedRevision || body.evidenceFingerprint !== current.evidenceFingerprint) return response({ error: 'Audit changed' }, 409);
        const next = structuredClone(current), previous = next.record || { schemaVersion: 1, formalId: body.id, projectToken: project, revision: 0, links: [], issues: [], history: [], historyDropped: 0, updatedAt: '' };
        next.record = previous; next.expectedRevision++; previous.revision = next.expectedRevision; previous.updatedAt = '2026-10-12T00:00:00Z';
        let before, after;
        if (body.action.endsWith('link')) {
            before = previous.links.find(link => link.id === body.linkId);
            after = { ...before, id: before?.id || 'link-' + ++count, prose: body.prose || before.prose, lean: body.lean || before.lean, verdict: body.verdict,
                note: body.note, reviewer: body.reviewer, correspondences: body.correspondences, checkedEvidenceFingerprint: fingerprint, createdAt: previous.updatedAt, checkedAt: previous.updatedAt };
            if (before) previous.links[previous.links.indexOf(before)] = after; else previous.links.push(after);
            next.links = previous.links.map(link => ({ link, freshness: 'current', reasons: [] }));
        } else {
            before = previous.issues.find(issue => issue.id === body.issueId);
            after = { ...before, id: before?.id || 'issue-' + ++count, linkId: body.linkId, category: body.category, title: body.title, note: body.note, status: body.status,
                resolution: body.resolution, reviewer: body.reviewer, checkedEvidenceFingerprint: fingerprint, checkedLinkFingerprint: '3'.repeat(64), createdAt: previous.updatedAt, updatedAt: previous.updatedAt };
            if (before) previous.issues[previous.issues.indexOf(before)] = after; else previous.issues.push(after);
            next.issues = previous.issues.map(issue => ({ issue, freshness: 'current', reasons: [], unresolved: issue.status === 'open' }));
        }
        previous.history.push({ revision: previous.revision, action: body.action, targetId: after.id, at: previous.updatedAt, reviewer: body.reviewer, ...(before ? { before } : {}), after });
        stores.set(body.id, next); return response(next);
    };
    const exports = {};
    const lucide = {}; vm.runInNewContext('(function(exports) {\n' + await fs.readFile(require.resolve('lucide'), 'utf8') + '\n})(exports);', { exports: lucide, document });
    const icons = {}, iconSource = await fs.readFile(path.join(repoRoot, 'src/reader/web/reader-icons.ts'), 'utf8');
    vm.runInNewContext(ts.transpileModule(iconSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
        { exports: icons, document, require: () => lucide });
    const source = await fs.readFile(path.join(repoRoot, 'src/reader/web/reader-lean-audit.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(compiled, { exports, document, URL, Blob, setTimeout, require: name => name === './reader-ui-labels' ? readerUiLabels : name === './reader-icons' ? icons : name.endsWith('.css') ? {} : { copyReaderText: async text => { copied.push(text); return true; } } });
    const panel = new exports.ReaderLeanAudit({ context: () => context, request, report: (text, warning) => reports.push({ text, warning }),
        openReview: id => opened.push(id), locateProse: source => proseJumps.push(source), openSource: source => codeJumps.push(source),
        canAssist: () => true, assist: async content => assists.push(content), download: (name, content) => downloads.push({ name, content }) });
    const region = panel.mount(); document.body.append(region);
    function find(action) { const value = region.querySelector(`[data-lean-audit-action="${action}"]`); assert.ok(value, action); return value; }
    function field(name, value) { const element = region.querySelector(`[data-lean-audit-field="${name}"]`); assert.ok(element, name); element.value = value; element.emit(element.tagName === 'SELECT' ? 'change' : 'input'); }
    function select(side, quote) { const element = region.querySelector(`[data-lean-audit-selection="${side}"]`); assert.ok(element); const start = element.value.indexOf(quote); assert.ok(start >= 0); element.setSelectionRange(start, start + quote.length); element.emit('select'); }
    return { ...exports, panel, context, region, stores, requests, reports, opened, proseJumps, codeJumps, assists, downloads, copied, find, field, select, override: fn => override = fn };
}

export async function testReaderLeanAudit() {
    const h = await harness(); h.panel.update(review(h.stores.get(A)), { subclaimId: 'construction', declarationKey: 'formal:Book.certificate_input' }); await settle();
    assert.match(h.region.textContent, /整对象人工结论：部分对应/); assert.equal(h.find('save-link').disabled, true);
    const iconAction = (name, expected) => { const button = h.find(name), description = button.getAttribute('aria-label'); assert.equal(button.textContent, '');
        assert.equal(button.children[0].tagName, 'SVG'); assert.match(description, expected); assert.equal(button.getAttribute('title'), description); assert.equal(button.dataset.readerTooltip, description); return button; };
    iconAction('save-link', /请先选择当前两侧原文/); iconAction('capture-lean', /非空范围/); iconAction('reload', /重新读取/);
    const saveBeforeLanguage = h.find('save-link'), captureBeforeLanguage = h.find('capture-lean'), nodesBeforeLanguage = [...h.region.childNodes], requestsBeforeLanguage = h.requests.length;
    h.context.language = 'en'; h.panel.refreshLanguage();
    assert.equal(h.find('save-link'), saveBeforeLanguage); assert.equal(h.find('capture-lean'), captureBeforeLanguage);
    assert.ok(nodesBeforeLanguage.every((node, index) => h.region.childNodes[index] === node));
    iconAction('save-link', /^Save this source association.*Select both current source ranges first/);
    iconAction('capture-lean', /^Use current source viewer selection.*Select a nonempty range/);
    assert.equal(h.requests.length, requestsBeforeLanguage, 'A locale refresh only relabels current audit controls.');
    h.context.language = 'zh'; h.panel.refreshLanguage(); iconAction('save-link', /^保存此位置关联.*请先选择当前两侧原文/);
    h.select('prose', 'certificate can be constructed'); h.select('lean', 'certificate.proof');
    h.field('link-reviewer', '作者'); h.field('link-verdict', 'difference'); h.field('link-note', '仅使用输入证书，未构造证书。');
    h.find('add-pair').click(); h.field('pair-prose-0', '构造证书'); h.field('pair-lean-0', 'certificate : Certificate n');
    assert.equal(h.find('save-link').disabled, false); h.find('save-link').click(); await settle();
    iconAction('save-link', /保存此位置关联/);
    const sent = JSON.parse(h.requests.find(request => request.options.method === 'POST').options.body);
    assert.equal(sent.expectedRevision, 0); assert.equal(sent.prose.subclaimId, 'construction'); assert.equal(sent.prose.range.start.line, 2);
    assert.equal(sent.prose.range.start.character, h.stores.get(A).proseSources[0].source.content.indexOf('certificate'), 'Character offsets retain UTF-16 emoji width.');
    assert.equal(sent.lean.quote, 'certificate.proof'); assert.equal(sent.correspondences[0].prose, '构造证书');
    assert.match(h.region.textContent, /仅使用输入证书/); assert.match(h.region.textContent, /create-link/);
    h.find('jump-prose').click(); h.find('jump-lean').click(); await settle();
    const glyph = name => h.find(name).children[0].children.map(node => [node.tagName, [...node.attributes]]);
    assert.notDeepEqual(glyph('jump-prose'), glyph('jump-lean'), 'Adjacent prose and Lean location actions use different glyphs.');
    assert.equal(h.proseJumps[0].startLine, 3); assert.equal(h.codeJumps[0].sourceHash, '2'.repeat(64));
    h.find('create-issue').click(); h.field('issue-title', '构造要求变为输入假设'); h.field('issue-note', '须由人工确认范围'); h.field('issue-category', 'assumption');
    h.find('save-issue').click(); await settle(); assert.match(h.region.textContent, /构造要求变为输入假设/);
    h.find('edit-issue').click(); h.field('issue-status', 'resolved'); h.field('issue-resolution', '正文已明确限定范围，人工复核后处理。');
    h.find('save-issue').click(); await settle(); assert.match(h.region.textContent, /已解决/);
    assert.ok(h.stores.get(A).record.history.at(-1).before.status === 'open');
    h.find('assist').click(); await settle(); assert.equal(h.assists.length, 1); assert.match(h.assists[0][0].resource.text, /候选建议/); assert.match(h.reports.at(-1).text, /尚未发送/);
    h.find('export').click(); await settle(); assert.equal(h.downloads[0].name, 'lean-human-review-2026-10-12.md');
    h.find('overview').click(); await settle(); assert.match(h.region.textContent, /other\/two.md/); h.find('open-object').click(); assert.equal(h.opened[0], A);

    const cleanPeer = structuredClone(h.stores.get(A)); cleanPeer.expectedRevision++; cleanPeer.record.revision++;
    cleanPeer.links[0].link.note = 'Metadata-only clean refresh'; cleanPeer.record.links[0].note = 'Metadata-only clean refresh'; h.stores.set(A, cleanPeer);
    h.panel.metadataChanged(); await settle(); assert.match(h.region.textContent, /Metadata-only clean refresh/, 'An explicit metadata event refreshes a clean view even without a source revision.');

    // Audit-only changes cause a refresh; an old edit draft keeps its original CAS base.
    h.find('edit-link').click(); h.field('link-note', 'My unsaved edit');
    const originalRevision = h.stores.get(A).expectedRevision, peer = structuredClone(h.stores.get(A));
    peer.expectedRevision++; peer.record.revision++; peer.links[0].link.note = 'Peer window saved'; peer.record.links[0].note = 'Peer window saved'; h.stores.set(A, peer); h.context.revision++;
    h.panel.update(review(peer), { subclaimId: 'construction', declarationKey: 'formal:Book.certificate_input' }); await settle();
    assert.match(h.region.textContent, /Peer window saved/); assert.equal(h.region.querySelector('[data-lean-audit-field="link-note"]').value, 'My unsaved edit');
    assert.equal(h.panel.draft.baseRevision, originalRevision); assert.equal(h.find('save-link').disabled, true, 'Peer save cannot silently rebase an edit draft to its revision.');
    const savesBefore = h.requests.filter(request => request.options.method === 'POST').length; h.find('save-link').click(); await settle();
    assert.equal(h.requests.filter(request => request.options.method === 'POST').length, savesBefore);
    h.find('cancel-link').click(); h.find('edit-link').click(); assert.equal(h.region.querySelector('[data-lean-audit-field="link-note"]').value, 'Peer window saved');
    h.find('cancel-link').click(); h.find('edit-issue').click(); h.field('issue-note', 'Issue draft survives navigation');
    h.panel.update(review(h.stores.get(B))); await settle(); h.panel.update(review(h.stores.get(A))); await settle();
    assert.equal(h.region.querySelector('[data-lean-audit-field="issue-note"]').value, 'Issue draft survives navigation');
    const issueBase = h.panel.issueDraft.baseRevision, issuePeer = structuredClone(h.stores.get(A)); issuePeer.expectedRevision++; issuePeer.record.revision++; h.stores.set(A, issuePeer);
    h.panel.metadataChanged(); await settle(); assert.equal(h.panel.issueDraft.baseRevision, issueBase); assert.equal(h.find('save-issue').disabled, true, 'A retained issue draft cannot overwrite a newer peer revision.');
    h.find('cancel-issue').click();

    // Evidence/manual changes keep old selections visible but require both current selections.
    h.select('prose', 'certificate'); h.select('lean', 'certificate.proof'); assert.equal(h.find('save-link').disabled, false);
    const changed = structuredClone(h.stores.get(A)); changed.evidenceFingerprint = 'e'.repeat(64); h.stores.set(A, changed); h.context.revision++;
    h.panel.update(review(changed)); await settle(); assert.equal(h.find('save-link').disabled, true);
    assert.match(h.region.textContent, /当前证据和人工分项版本/); h.find('cancel-link').click();

    const delayed = deferred(); h.override(route => route.includes('/api/lean-audit?id=' + A) ? delayed.promise : undefined); h.context.revision++;
    h.panel.update(review(changed)); h.panel.update(review(h.stores.get(B))); await settle(); delayed.resolve(response(changed)); await settle();
    assert.equal(h.panel.payload.id, B, 'An old object response cannot overwrite a new selection.'); assert.match(h.region.textContent, /other\/two.md/); h.override(undefined);
    h.panel.hide(); assert.equal(h.region.hidden, true); h.panel.update(review(h.stores.get(A))); await settle();
    h.select('prose', 'certificate'); h.select('lean', 'certificate.proof');
    const saveGate = deferred(); h.override((route, options) => options.method === 'POST' ? saveGate.promise : undefined);
    h.find('save-link').click(); h.panel.hide(); h.panel.update(review(h.stores.get(B))); await settle(); saveGate.resolve(response(changed)); await settle();
    assert.equal(h.panel.payload.id, B, 'A late save response cannot reopen or overwrite another object.');
    assert.equal(h.leanAuditAssistance({ ...payload(), links: [{ link: { note: 'x'.repeat(80000) }, freshness: 'current', reasons: [] }] }).length <= 40000, true, 'Discussion context remains bounded.');
    h.panel.destroy(); assert.equal(h.region.parentElement, undefined);

    const code = await harness(), codeSource = code.stores.get(A).leanSources[0];
    const sourceSelection = { declarationKey: codeSource.key, projectKey: 'formal', filePath: codeSource.source.filePath, sourceHash: codeSource.fileHash,
        range: { start: { line: 7, character: 0 }, end: { line: 7, character: 0 } } };
    code.panel.update(review(code.stores.get(A)), sourceSelection); await settle(); assert.equal(code.find('capture-lean').disabled, true, 'A cursor alone is not a selected source range.');
    const offset = codeSource.source.content.indexOf('certificate.proof'); sourceSelection.range = { start: { line: 7, character: offset }, end: { line: 7, character: offset + 17 } };
    code.panel.selectionChanged(sourceSelection); assert.equal(code.find('capture-lean').disabled, false); code.find('capture-lean').click(); code.select('prose', 'certificate');
    code.find('save-link').click(); code.panel.metadataChanged(); await settle();
    const sourceRequest = JSON.parse(code.requests.find(request => request.options.method === 'POST').options.body);
    assert.equal(sourceRequest.lean.fileHash, codeSource.fileHash); assert.equal(sourceRequest.lean.range.start.character, offset);
    assert.equal(code.panel.payload.expectedRevision, 1); assert.equal(code.panel.draft.baseRevision, undefined);
    assert.equal(code.panel.draft.lean, undefined, 'An own-save metadata event clears its saved draft while rejecting a stale response projection.');
    assert.match(code.reports.at(-1).text, /已保存/); code.panel.destroy();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { await testReaderLeanAudit(); console.log('ok - source audit Reader selections, issue decisions, drafts, history and response fencing'); }
