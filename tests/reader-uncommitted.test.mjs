import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { readerToolbarHarness } from './reader-toolbar-menu.test.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const digest = text => createHash('sha256').update(text).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const drain = async () => { for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve)); };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export async function testReaderUncommitted() {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-uncommitted-contracts-'));
    try {
        await build({ entryPoints: [path.join(root, 'src/reader/git-changes.ts')], outfile: path.join(temporary, 'git.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
        const childProcess = require('node:child_process'), originalExec = childProcess.execFile;
        let blobBatches = 0;
        childProcess.execFile = (command, args, ...rest) => {
            if (command === 'git' && args.includes('--batch')) blobBatches++;
            return originalExec(command, args, ...rest);
        };
        let api;
        try { api = require(path.join(temporary, 'git.cjs')); } finally { childProcess.execFile = originalExec; }
        const { readReaderGitChanges: read, readReaderGitFileChanges: readFiles, readReaderGitPrevious: before } = api;
        const repo = path.join(temporary, 'project'); await fs.mkdir(repo); git(repo, 'init', '-q');
        git(repo, 'config', 'user.name', 'Reader fixture'); git(repo, 'config', 'user.email', 'reader@example.invalid');
        const name = 'book/chapter.md'; await fs.mkdir(path.join(repo, 'book'));
        const initial = '# Page\n\nFirst original.\n\nSecond original.\n\nUnchanged separator.\n\nRemove this paragraph.\n\nLast original.\n';
        const put = async content => { await fs.writeFile(path.join(repo, name), content); return read(repo, name, content); };
        await put(initial); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'Initial manuscript');
        assert.deepEqual((await read(repo, name, initial)).ranges, []);
        const staged = initial.replace('First original.', 'First staged.'); await put(staged); git(repo, 'add', name);
        const working = staged.replace('Second original.', 'Second working.').replace('Remove this paragraph.\n\n', '');
        const dirty = await put(working);
        assert.equal(dirty.status, 'ready'); assert.equal(dirty.baseline, 'HEAD');
        assert.ok(dirty.ranges.some(range => range.startLine <= 3 && range.endLine >= 3), 'Staged changes are compared to HEAD.');
        assert.ok(dirty.ranges.some(range => range.startLine <= 5 && range.endLine >= 5), 'Unstaged changes are included.');
        assert.ok(dirty.deletions.some(deletion => deletion.afterLine === 8 && deletion.count === 2));
        assert.equal(dirty.sourceHash, digest(working));
        const previous = await before(repo, name, working);
        assert.equal(previous.content, initial); assert.equal(previous.commit, git(repo, 'rev-parse', 'HEAD').trim());
        assert.ok(previous.hunks.some(hunk => hunk.beforeCount === 2 && hunk.count === 0), 'Deletion navigation retains the old source position.');
        assert.equal((await before(repo, name, initial)).status, 'stale');
        assert.deepEqual((await readFiles(repo, new Map([[name, working]]))).files, { [name]: 'modified' });
        const checkedBatches = blobBatches;
        assert.deepEqual((await readFiles(repo, new Map([[name, working]]))).files, { [name]: 'modified' });
        assert.equal(blobBatches, checkedBatches, 'Unchanged snapshot bytes reuse the committed-blob comparison on later polls.');
        assert.deepEqual((await put(initial)).ranges, [], 'Staged changes cancelled in the working tree are not falsely marked.');
        assert.deepEqual((await readFiles(repo, new Map([[name, initial]]))).files, {}, 'File badges follow rendered bytes even when the index differs.');
        assert.deepEqual((await readFiles(repo, new Map([[name, initial.replace(/\n/g, '\r\n')]]))).files, {}, 'CRLF alone does not create a file badge.');
        assert.equal((await read(repo, name, working)).status, 'stale', 'A stale rendered snapshot cannot receive fresh line positions.');
        const newName = 'book/new : [稿件].md', newContent = '# New\n\nNew text.\n';
        await fs.writeFile(path.join(repo, newName), newContent);
        assert.deepEqual((await read(repo, newName, newContent)).ranges, [{ startLine: 1, endLine: 3 }]);
        git(repo, 'add', newName);
        assert.equal((await before(repo, newName, newContent)).content, undefined, 'A new file never invents a prior version.');
        assert.equal((await read(repo, newName, newContent)).baseline, 'new-file', 'A staged addition is still uncommitted.');
        assert.deepEqual((await readFiles(repo, new Map([[name, working], [newName, newContent]]))).files, { [newName]: 'added', [name]: 'modified' });
        await fs.writeFile(path.join(repo, '.gitignore'), 'ignored.md\n'); await fs.writeFile(path.join(repo, 'ignored.md'), '# Ignored');
        assert.equal((await read(repo, 'ignored.md', '# Ignored')).status, 'ignored');
        assert.deepEqual((await readFiles(repo, new Map([['ignored.md', '# Ignored']]))).files, {});
        assert.equal((await read(repo, '../outside.md', '# Private')).status, 'unavailable');
        const outside = path.join(temporary, 'outside.md'); await fs.writeFile(outside, '# Outside'); await fs.symlink(outside, path.join(repo, 'linked.md'));
        assert.notEqual((await read(repo, 'linked.md', '# Outside')).status, 'ready');
        const indexBefore = await fs.readFile(path.join(repo, '.git/index'));
        await put(working);
        const headBefore = git(repo, 'rev-parse', 'HEAD');
        const trap = path.join(temporary, 'filter-trap.sh'), trapReceipt = path.join(temporary, 'filter-ran');
        await fs.writeFile(trap, `#!/bin/sh\ntouch '${trapReceipt}'\ncat\n`); await fs.chmod(trap, 0o755);
        git(repo, 'config', 'filter.reader.clean', trap); git(repo, 'config', 'diff.reader.command', trap);
        await fs.writeFile(path.join(repo, '.gitattributes'), '*.md filter=reader diff=reader\n');
        await read(repo, name, working + 'stale');
        const uncached = working + '\nAnother pending paragraph.\n'; await put(uncached);
        assert.equal((await before(repo, name, uncached)).content, initial);
        assert.deepEqual((await readFiles(repo, new Map([[name, uncached], [newName, newContent]]))).files, { [newName]: 'added', [name]: 'modified' });
        assert.equal(await fs.access(trapReceipt).then(() => true, () => false), false, 'Reading markers does not execute project clean/diff helpers.');
        assert.deepEqual(await fs.readFile(path.join(repo, '.git/index')), indexBefore); assert.equal(git(repo, 'rev-parse', 'HEAD'), headBefore);
        await fs.rm(path.join(repo, '.gitattributes')); git(repo, 'config', '--remove-section', 'filter.reader'); git(repo, 'config', '--remove-section', 'diff.reader');
        git(repo, 'add', name); git(repo, 'commit', '-qm', 'Accept changed manuscript');
        assert.deepEqual((await read(repo, name, uncached)).ranges, [], 'A commit clears markers without changing Markdown bytes.');
        assert.deepEqual((await readFiles(repo, new Map([[name, uncached]]))).files, {}, 'A commit clears file badges too.');
        const worktree = path.join(temporary, 'worktree'); git(repo, 'worktree', 'add', '--detach', '-q', worktree);
        const worktreeContent = uncached.replace('First staged.', 'Worktree edit.'); await fs.writeFile(path.join(worktree, name), worktreeContent);
        assert.ok((await read(path.join(worktree, 'book'), 'chapter.md', worktreeContent)).ranges.length, 'Linked worktrees and nested project roots use the owning Git history.');
        assert.deepEqual((await readFiles(path.join(worktree, 'book'), new Map([['chapter.md', worktreeContent], [path.basename(newName), newContent]]))).files, { 'chapter.md': 'modified' });
        const unborn = path.join(temporary, 'unborn'); await fs.mkdir(unborn); git(unborn, 'init', '-q'); await fs.writeFile(path.join(unborn, 'new.md'), newContent);
        assert.equal((await read(unborn, 'new.md', newContent)).baseline, 'new-file');
        assert.deepEqual((await readFiles(unborn, new Map([['new.md', newContent]]))).files, { 'new.md': 'added' });
        const ordinary = path.join(temporary, 'ordinary'); await fs.mkdir(ordinary); await fs.writeFile(path.join(ordinary, 'page.md'), initial);
        assert.equal((await read(ordinary, 'page.md', initial)).status, 'not-git');
        assert.equal((await readFiles(ordinary, new Map([['page.md', initial]]))).status, 'not-git');
        const deleted = await put(''); assert.ok(deleted.deletions.length); assert.equal(deleted.ranges.length, 0);

        await uiContracts();
        await fileUiContracts();
        console.log('Reader uncommitted markers: HEAD/staged/working/new files, deletion positions, worktrees, snapshot guards, no project writes, opt-in lifecycle and stale responses passed.');
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

async function fileUiContracts() {
    const h = await readerToolbarHarness(), { app, document, find, click } = h;
    const toggle = () => { if (find('#reader-category-menu').hidden) click(find('[data-tool-menu="display"]')); click(find('#reader-uncommitted')); };
    try {
        const page = { filePath: 'book/01.md', title: 'Changed', documentMode: 'formal', bookKey: 'book' };
        const other = { ...page, filePath: 'book/02.md', title: 'Other' };
        app.state.pages = [page, other]; app.state.requestToken = 'token-a';
        app.selectedPagePaths = [page.filePath]; app.page = { filePath: page.filePath, page };
        const header = document.createElement('span'); header.dataset.fileStatus = page.filePath; app.pageTitle.append(header);
        let summary = { revision: 1, status: 'ready', files: { [page.filePath]: 'modified', [other.filePath]: 'added' } };
        let resolvePending, pending;
        const handle = async route => {
            if (route === '/api/file-changes') return pending ? pending : { ok: true, json: async () => plain(summary) };
            if (route.startsWith('/api/page-changes')) return { ok: true, json: async () => ({ filePath: page.filePath, sourceHash: 'snapshot', status: 'ready', ranges: [], deletions: [] }) };
            throw new Error(route);
        };
        h.setRequestHandler(handle);
        app.applyState(app.state);
        app.uncommitted.bind({ filePath: page.filePath, project: 'project-a', token: 'token-a', sourceHash: 'snapshot' });
        assert.equal(h.createRequests.length, 0, 'The default-off switch also prevents project-wide Git reads.');
        toggle(); await drain();
        const changed = find('[data-page-path="book/01.md"]'), added = find('[data-page-path="book/02.md"]');
        assert.ok(changed.querySelector('.reader-file-change'), 'Changed files receive a compact badge.');
        assert.equal(changed.querySelector('.reader-file-change').textContent, '', 'The dot is drawn without a text glyph.');
        const titleGroup = changed.querySelector('.reader-nav-page-title');
        assert.deepEqual(titleGroup.children, [changed.querySelector('.reader-nav-page-label'), changed.querySelector('.reader-file-change')], 'The change dot follows the title inside its text group.');
        assert.equal(changed.children[0], titleGroup);
        assert.equal(titleGroup.contains(changed.querySelector('.reader-page-integration')), false, 'Status icons stay after the title and its dot.');
        assert.equal(added.querySelector('.reader-file-change').classList.contains('is-added'), true);
        assert.match(changed.getAttribute('aria-label'), /未提交修改/);
        assert.ok(header.querySelector('.reader-file-change'));
        app.openTitleNavigation(app.pageTitle);
        assert.equal(find('[data-chapter-path="book/02.md"]').querySelector('.reader-file-change').dataset.readerTooltip, '新增文件（未提交）');
        h.preferences.setLanguage('en'); app.uncommitted.updateLanguage();
        assert.equal(changed.querySelector('.reader-file-change').dataset.readerTooltip, 'Uncommitted changes');
        assert.match(added.getAttribute('aria-label'), /New file/);
        summary = { ...summary, files: {} }; h.flushTimers(); await drain();
        assert.equal(changed.querySelector('.reader-file-change'), null, 'A commit clears off-page badges without a manuscript event.');
        h.setRequestHandler(async route => route === '/api/file-changes' ? { ok: false, status: 404 } : handle(route)); h.flushTimers(); await drain();
        assert.equal(find('#reader-uncommitted-status').textContent, 'Restart Reader', 'An old service cannot silently omit file badges.');
        h.setRequestHandler(handle);
        summary = { ...summary, revision: 0, files: { [page.filePath]: 'modified' } }; h.flushTimers(); await drain();
        assert.equal(header.querySelector('.reader-file-change'), null, 'A summary for another source revision is not displayed.');
        pending = new Promise(resolve => { resolvePending = resolve; }); h.flushTimers(); await drain();
        toggle();
        resolvePending({ ok: true, json: async () => ({ ...summary, revision: 1 }) }); await drain();
        assert.equal(changed.querySelector('.reader-file-change'), null, 'Disabled mode rejects a late file summary.');
        pending = undefined; summary.revision = 1;
        toggle(); await drain();
        assert.ok(changed.querySelector('.reader-file-change'));
        app.uncommitted.bindProject({ project: 'project-b', token: 'token-b', revision: 1 });
        assert.equal(changed.querySelector('.reader-file-change'), null, 'Project switches clear file state immediately.');
    } finally { app.uncommitted.dispose(); h.restore(); }
}

async function uiContracts() {
    const h = await readerToolbarHarness({ withoutWebCrypto: true }), { app, find, click, document } = h;
    try {
        const source = '# Original\n\nA changed paragraph.\n\nAn unchanged paragraph.\n';
        const heading = document.createElement('h1'), paragraph = document.createElement('p'), unchanged = document.createElement('p');
        for (const [element, start, text] of [[heading, 1, 'Original'], [paragraph, 3, 'A changed paragraph.'], [unchanged, 5, 'An unchanged paragraph.']]) {
            element.dataset.sourceStartLine = String(start); element.dataset.sourceEndLine = String(start); element.textContent = text; app.article.append(element);
        }
        paragraph.setAttribute('data-reader-tooltip', 'Existing tooltip');
        const expected = { filePath: 'book/01.md', sourceHash: digest(source), status: 'ready', ranges: [{ startLine: 3, endLine: 3 }], deletions: [{ afterLine: 4, count: 2 }] };
        let pending;
        h.setRequestHandler(async route => route.startsWith('/api/page-changes') ? pending ? await pending : { ok: true, json: async () => plain(expected) } : Promise.reject(new Error(route)));
        const page = { filePath: 'book/01.md', sourceHash: digest(source), project: 'project-a', token: 'token-a' };
        app.uncommitted.bind(page);
        assert.equal(find('#reader-uncommitted').getAttribute('aria-checked'), 'false'); assert.equal(h.createRequests.length, 0, 'Default-off mode performs no Git request.');
        click(find('[data-tool-menu="display"]')); click(find('#reader-uncommitted')); await drain();
        assert.equal(find('#reader-category-menu').hidden, false); assert.equal(find('#reader-uncommitted').getAttribute('aria-checked'), 'true');
        assert.equal(paragraph.classList.contains('has-uncommitted-change'), true); assert.equal(heading.classList.contains('has-uncommitted-change'), false);
        assert.equal(find('#reader-uncommitted-status').textContent, '2 处', 'Embedded views work without Web Crypto and visibly report rendered markers.');
        assert.equal(app.article.querySelectorAll('.reader-change-marker').length, 0, 'Prose tint leaves the dependency gutter free of change markers.');
        assert.equal(unchanged.classList.contains('has-uncommitted-change'), false); assert.equal(unchanged.classList.contains('has-uncommitted-deletion'), true);
        assert.equal(paragraph.textContent, 'A changed paragraph.'); assert.match(paragraph.dataset.readerTooltip, /3/);
        const requests = h.createRequests.length; h.preferences.setLanguage('en'); app.uncommitted.updateLanguage();
        assert.match(paragraph.dataset.readerTooltip, /Uncommitted/); assert.equal(h.createRequests.length, requests, 'Relabeling does not repeat the Git request.');
        click(find('#reader-uncommitted')); assert.equal(paragraph.classList.contains('has-uncommitted-change'), false);
        assert.equal(paragraph.dataset.readerTooltip, 'Existing tooltip'); assert.equal(unchanged.classList.contains('has-uncommitted-deletion'), false);
        assert.equal(find('#reader-uncommitted-status').hidden, true);
        assert.equal(app.article.querySelectorAll('.reader-change-marker').length, 0);
        let finish; pending = new Promise(resolve => { finish = resolve; });
        click(find('#reader-uncommitted')); await drain();
        app.uncommitted.bind(); finish({ ok: true, json: async () => expected }); await drain();
        assert.equal(paragraph.classList.contains('has-uncommitted-change'), false, 'An old page response cannot mark the next page.');
        pending = undefined; expected.sourceHash = digest('Other version'); app.uncommitted.bind(page); await drain();
        assert.equal(paragraph.classList.contains('has-uncommitted-change'), false, 'Wrong snapshot hashes cannot be projected onto current prose.');
        expected.sourceHash = digest(source); app.uncommitted.bind(page); await drain();
        assert.equal(paragraph.classList.contains('has-uncommitted-change'), true);
        expected.ranges = []; expected.deletions = []; h.flushTimers(); await drain();
        assert.equal(paragraph.classList.contains('has-uncommitted-change'), false, 'Polling clears markers when Git HEAD catches up.');
        assert.equal(find('#reader-uncommitted-status').textContent, 'No changes');
        h.setRequestHandler(async () => ({ ok: false, status: 404 })); h.flushTimers(); await drain();
        assert.equal(find('#reader-uncommitted-status').textContent, 'Restart Reader', 'Old running services cannot silently leave the toggle looking enabled.');
        assert.match(find('#reader-uncommitted').dataset.readerTooltip, /restart the client/);
        h.setRequestHandler(async () => { throw new Error('Host transport unavailable'); }); h.flushTimers(); await drain();
        assert.equal(find('#reader-uncommitted-status').textContent, 'Read failed');
        h.setRequestHandler(async () => ({ ok: true, json: async () => ({ ...expected, status: 'not-git' }) })); h.flushTimers(); await drain();
        assert.equal(find('#reader-uncommitted-status').textContent, 'No Git repository');
    } finally { app.uncommitted.dispose(); h.restore(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) await testReaderUncommitted();
