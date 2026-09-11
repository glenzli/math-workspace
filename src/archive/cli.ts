import * as path from 'node:path';
import { AcademicArchive, compareFiles } from './store';
import { archiveFormats } from './formats';
import { convertOetArchive, discoverOetArchives, writeExchangeFile } from './oet-converter';
import { MAX_ARCHIVE_BYTES, parseJson, recoverLock } from './io';
const fs = require('node:fs/promises');

const HELP = `Academic archives — original evidence stays in the writing project.

math-workspace archive status|list|sources [--root PROJECT]
math-workspace archive formats
math-workspace archive init --work-id ID --title TITLE --path PATH [--path PATH] --identity EMAIL --issuer URL [--root PROJECT]
math-workspace archive convert --format oet --from RELATIVE/.signatures --out EXCHANGE.json [--root PROJECT]
math-workspace archive import --from EXCHANGE.json [--root PROJECT] [--trusted-root FILE]
math-workspace archive import-oet --from RELATIVE/.signatures [--initialize] [--root PROJECT]
math-workspace archive verify [--expected-head SHA256] [--root PROJECT]
math-workspace archive prepare --label LABEL [--root PROJECT]
math-workspace archive sign --prepared SHA256 [--root PROJECT]
math-workspace archive show --record ID --file RELATIVE/PATH [--root PROJECT]
math-workspace archive history --file RELATIVE/PATH | --formal-id h-ID [--root PROJECT]
math-workspace archive compare --left RECORD_ID --right RECORD_ID [--root PROJECT]
math-workspace archive export --out EXCHANGE.json [--root PROJECT]
math-workspace archive recover-lock [--root PROJECT]

init accepts --extension .md (repeatable), --depth N and --exclude PATH.
Only sign starts an OIDC signing operation. Preparing and importing do not sign,
edit source Markdown, commit, push, or publish the project. Git timestamps and
preparedAt are locators, not independently authenticated signing times.`;

export async function runArchiveCli(args: string[]): Promise<void> {
    const [command = 'help', ...tail] = args;
    if (command === 'help' || command === '--help') { console.log(HELP); return; }
    const flags = new Map<string, string[]>(), switches = new Set<string>();
    for (let index = 0; index < tail.length; index++) {
        const flag = tail[index];
        if (flag === '--initialize') { switches.add(flag); continue; }
        if (!flag.startsWith('--') || !tail[index + 1] || tail[index + 1].startsWith('--')) throw new Error(`Missing value for archive option: ${flag}`);
        flags.set(flag, [...(flags.get(flag) || []), tail[++index]]);
    }
    const allowed = new Set(['--root', '--trusted-root', '--work-id', '--title', '--path', '--identity', '--issuer', '--extension', '--depth', '--exclude', '--format', '--from', '--out', '--expected-head', '--label', '--prepared', '--record', '--file', '--formal-id', '--left', '--right']);
    for (const flag of flags.keys()) if (!allowed.has(flag)) throw new Error(`Unknown archive option: ${flag}`);
    const commandFlags: Record<string, string[]> = {
        status: [], list: [], sources: [], formats: [], 'recover-lock': [],
        init: ['--work-id', '--title', '--path', '--identity', '--issuer', '--extension', '--depth', '--exclude'],
        convert: ['--format', '--from', '--out'], import: ['--from'], 'import-oet': ['--from'],
        verify: ['--expected-head'], prepare: ['--label'], sign: ['--prepared'], show: ['--record', '--file'],
        history: ['--file', '--formal-id'], compare: ['--left', '--right'], export: ['--out']
    };
    if (!Object.hasOwn(commandFlags, command)) throw new Error('Unknown archive command.\n' + HELP);
    for (const flag of flags.keys()) if (!['--root', '--trusted-root', ...commandFlags[command]].includes(flag)) throw new Error(`${flag} does not apply to archive ${command}.`);
    if (switches.has('--initialize') && command !== 'import-oet') throw new Error('--initialize only applies to import-oet.');
    const one = (name: string, required = false): string | undefined => {
        const values = flags.get(name) || [];
        if (values.length > 1 || required && values.length !== 1) throw new Error(`Specify ${name} once.`);
        return values[0];
    };
    const root = path.resolve(one('--root') || process.cwd()), archive = await AcademicArchive.open(root, one('--trusted-root'));
    const progress = (done: number, total: number) => { if (done % 25 === 0 || done === total) console.error(`Archive verification: ${done}/${total}`); };
    let result: any;
    if (command === 'formats') result = { exchange: 'math-workspace.archive-exchange/v1', formats: [...archiveFormats.keys()] };
    else if (command === 'sources') result = { sources: await discoverOetArchives(root) };
    else if (command === 'init') {
        const identity = { identity: one('--identity', true)!, issuer: one('--issuer', true)! };
        result = await archive.initialize({ schema: 'math-workspace.archive-policy/v1', workId: one('--work-id', true)!, title: one('--title', true)!,
            identities: [identity], signingIdentity: identity, scope: { paths: flags.get('--path') || [], extensions: flags.get('--extension') || ['.md'],
                ...(one('--depth') ? { maxDepth: Number(one('--depth')) } : {}), ...(flags.has('--exclude') ? { exclude: flags.get('--exclude') } : {}) } });
    } else if (command === 'convert') {
        if (one('--format', true) !== 'oet') throw new Error('The available source converter is oet.');
        const converted = await convertOetArchive(root, one('--from', true)!);
        await writeExchangeFile(path.resolve(one('--out', true)!), converted.exchange);
        result = { converted: true, records: converted.exchange.records.length, suggestedPolicy: converted.suggestedPolicy, signatureCreated: false };
    } else if (command === 'import-oet') {
        const converted = await convertOetArchive(root, one('--from', true)!);
        if (switches.has('--initialize')) await archive.initialize(converted.suggestedPolicy);
        result = await archive.import(converted.exchange, progress);
    } else if (command === 'import') {
        const file = path.resolve(one('--from', true)!);
        if ((await fs.stat(file)).size > MAX_ARCHIVE_BYTES * 1.5) throw new Error('Exchange file exceeds its byte limit.');
        result = await archive.import(parseJson(await fs.readFile(file)), progress);
    } else if (command === 'status') result = await archive.status();
    else if (command === 'list') result = await archive.records();
    else if (command === 'verify') result = await archive.verify(one('--expected-head'), progress);
    else if (command === 'prepare') result = await archive.prepare(one('--label', true)!);
    else if (command === 'sign') result = await archive.sign(one('--prepared', true)!);
    else if (command === 'show') result = await archive.source(one('--record', true)!, one('--file', true)!);
    else if (command === 'history') result = await archive.history({ filePath: one('--file'), formalId: one('--formal-id') });
    else if (command === 'compare') {
        result = await archive.compare(one('--left', true)!, one('--right', true)!);
    } else if (command === 'export') {
        await writeExchangeFile(path.resolve(one('--out', true)!), await archive.export()); result = { exported: true };
    } else if (command === 'recover-lock') { await archive.policy(); await recoverLock(archive.directory); result = { recovered: true }; }
    else throw new Error('Unknown archive command.\n' + HELP);
    console.log(JSON.stringify(result, null, 2));
}
