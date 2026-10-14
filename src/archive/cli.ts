import * as path from 'node:path';
import { AcademicArchive, compareFiles } from './store';
import { archiveFormats } from './formats';
import { convertOetArchive, discoverOetArchives, writeExchangeFile } from './oet-converter';
import { MAX_ARCHIVE_BYTES, parseJson, recoverLock } from './io';
const fs = require('node:fs/promises');

const HELP = `Academic archives — original evidence stays in the writing project.

math-workspace archive status|list|sources [--root PROJECT] [list: --include-hidden]
math-workspace archive formats
math-workspace archive init --work-id ID --title TITLE --path PATH [--path PATH] --identity EMAIL --issuer URL [--root PROJECT]
math-workspace archive init --policy POLICY.json [--root PROJECT]
math-workspace archive update-policy --policy POLICY.json [--expected-policy SHA256] [--root PROJECT]
math-workspace archive update-policy --volume ID=PATH [--volume ID=PATH] [--volume-title ID=TITLE] [--root PROJECT]
math-workspace archive convert --format oet --from RELATIVE/.signatures --out EXCHANGE.json [--root PROJECT]
math-workspace archive import --from EXCHANGE.json [--root PROJECT] [--trusted-root FILE]
math-workspace archive import-oet --from RELATIVE/.signatures [--initialize] [--root PROJECT]
math-workspace archive verify [--expected-head SHA256] [--root PROJECT]
math-workspace archive prepare --label LABEL [--root PROJECT]
math-workspace archive sign --prepared PLAN_SHA256 [--auth-flow normal|device] [--root PROJECT]
math-workspace archive hide --record ID [--retire-head] [--root PROJECT]
math-workspace archive restore --record ID [--root PROJECT]
math-workspace archive show --record ID --file RELATIVE/PATH [--root PROJECT]
math-workspace archive history --file RELATIVE/PATH | --formal-id h-ID [--root PROJECT]
math-workspace archive compare --left RECORD_ID --right RECORD_ID [--root PROJECT]
math-workspace archive export --out EXCHANGE.json [--record VOLUME_ID] [--root PROJECT]
math-workspace archive recover-lock [--root PROJECT]

init accepts --extension .md (repeatable), --depth N, --exclude PATH and explicit
--volume ID=PATH (repeatable). Directories are never inferred as volumes.
Preparation returns a plan ID; signing returns the final total record/bundle hashes.
Only changed volumes and the total are signed. Normal browser authentication is default.
Hidden originals still participate in strict verification and default full export.
Retiring a head preserves its original branch and restores the active predecessor.
Use update-policy --clear-volumes to explicitly configure total-only signing.
Only sign starts an OIDC signing operation. Preparing and importing do not sign,
edit source Markdown, commit, push, or publish the project. Git timestamps and
preparedAt are locators, not independently authenticated signing times.`;

export async function runArchiveCli(args: string[]): Promise<void> {
    const [command = 'help', ...tail] = args;
    if (command === 'help' || command === '--help') { console.log(HELP); return; }
    const flags = new Map<string, string[]>(), switches = new Set<string>();
    for (let index = 0; index < tail.length; index++) {
        const flag = tail[index];
        if (['--initialize', '--include-hidden', '--retire-head', '--clear-volumes'].includes(flag)) { switches.add(flag); continue; }
        if (!flag.startsWith('--') || !tail[index + 1] || tail[index + 1].startsWith('--')) throw new Error(`Missing value for archive option: ${flag}`);
        flags.set(flag, [...(flags.get(flag) || []), tail[++index]]);
    }
    const allowed = new Set(['--root', '--trusted-root', '--work-id', '--title', '--path', '--identity', '--issuer', '--extension', '--depth', '--exclude', '--format', '--from', '--out', '--expected-head', '--label', '--prepared', '--record', '--file', '--formal-id', '--left', '--right', '--policy', '--expected-policy', '--volume', '--volume-title', '--auth-flow']);
    for (const flag of flags.keys()) if (!allowed.has(flag)) throw new Error(`Unknown archive option: ${flag}`);
    const commandFlags: Record<string, string[]> = {
        status: [], list: [], sources: [], formats: [], 'recover-lock': [],
        init: ['--work-id', '--title', '--path', '--identity', '--issuer', '--extension', '--depth', '--exclude', '--policy', '--volume', '--volume-title'],
        'update-policy': ['--policy', '--expected-policy', '--volume', '--volume-title'], hide: ['--record'], restore: ['--record'],
        convert: ['--format', '--from', '--out'], import: ['--from'], 'import-oet': ['--from'],
        verify: ['--expected-head'], prepare: ['--label'], sign: ['--prepared', '--auth-flow'], show: ['--record', '--file'],
        history: ['--file', '--formal-id'], compare: ['--left', '--right'], export: ['--out', '--record']
    };
    if (!Object.hasOwn(commandFlags, command)) throw new Error('Unknown archive command.\n' + HELP);
    for (const flag of flags.keys()) if (!['--root', '--trusted-root', ...commandFlags[command]].includes(flag)) throw new Error(`${flag} does not apply to archive ${command}.`);
    const commandSwitches = { '--initialize': 'import-oet', '--include-hidden': 'list', '--retire-head': 'hide', '--clear-volumes': 'update-policy' };
    for (const flag of switches) if (commandSwitches[flag] !== command) throw new Error(`${flag} only applies to ${commandSwitches[flag]}.`);
    const one = (name: string, required = false): string | undefined => {
        const values = flags.get(name) || [];
        if (values.length > 1 || required && values.length !== 1) throw new Error(`Specify ${name} once.`);
        return values[0];
    };
    const root = path.resolve(one('--root') || process.cwd()), archive = await AcademicArchive.open(root, one('--trusted-root'));
    const volumes = () => {
        const groups = new Map<string, { id: string; title: string; paths: string[] }>();
        for (const value of flags.get('--volume') || []) {
            const separator = value.indexOf('=');
            if (separator < 1 || separator === value.length - 1) throw new Error('Use --volume ID=PROJECT_RELATIVE_PATH.');
            const id = value.slice(0, separator), name = value.slice(separator + 1);
            if (!groups.has(id)) groups.set(id, { id, title: id, paths: [] });
            groups.get(id)!.paths.push(name);
        }
        const titles = new Set<string>();
        for (const value of flags.get('--volume-title') || []) {
            const separator = value.indexOf('='), id = value.slice(0, separator);
            if (separator < 1 || separator === value.length - 1 || !groups.has(id) || titles.has(id)) throw new Error('Use --volume-title once for a declared ID=TITLE.');
            titles.add(id); groups.get(id)!.title = value.slice(separator + 1);
        }
        return [...groups.values()];
    };
    const policyFile = async () => {
        const file = path.resolve(one('--policy', true)!);
        if ((await fs.stat(file)).size > 1024 * 1024) throw new Error('Archive policy input exceeds its byte limit.');
        if ([...flags.keys()].some(flag => !['--root', '--trusted-root', '--policy', '--expected-policy'].includes(flag)) || switches.has('--clear-volumes')) throw new Error('--policy cannot be combined with inline policy fields.');
        return parseJson(await fs.readFile(file));
    };
    const progress = (done: number, total: number) => { if (done % 25 === 0 || done === total) console.error(`Archive verification: ${done}/${total}`); };
    let result: any;
    if (command === 'formats') result = { exchange: 'math-workspace.archive-exchange/v1', formats: [...archiveFormats.keys()] };
    else if (command === 'sources') result = { sources: await discoverOetArchives(root) };
    else if (command === 'init') {
        if (flags.has('--policy')) result = await archive.initialize(await policyFile());
        else {
        const identity = { identity: one('--identity', true)!, issuer: one('--issuer', true)! };
        result = await archive.initialize({ schema: 'math-workspace.archive-policy/v1', workId: one('--work-id', true)!, title: one('--title', true)!,
            identities: [identity], signingIdentity: identity, volumes: volumes(), scope: { paths: flags.get('--path') || [], extensions: flags.get('--extension') || ['.md'],
                ...(one('--depth') ? { maxDepth: Number(one('--depth')) } : {}), ...(flags.has('--exclude') ? { exclude: flags.get('--exclude') } : {}) } });
        }
    } else if (command === 'update-policy') {
        if (flags.has('--policy')) result = await archive.updatePolicy(await policyFile(), one('--expected-policy'));
        else {
            if (!flags.has('--volume') && !switches.has('--clear-volumes')) throw new Error('Specify explicit --volume mappings, --clear-volumes or --policy.');
            if (switches.has('--clear-volumes') && flags.has('--volume')) throw new Error('--clear-volumes cannot be combined with --volume.');
            const old = await archive.policy();
            result = await archive.updatePolicy({ ...old, volumes: volumes() }, one('--expected-policy'));
        }
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
    else if (command === 'list') {
        const { hiddenRecords: _, ...state } = await archive.records(false, undefined, switches.has('--include-hidden')); result = state;
    }
    else if (command === 'verify') result = await archive.verify(one('--expected-head'), progress);
    else if (command === 'prepare') result = await archive.prepare(one('--label', true)!);
    else if (command === 'sign') result = await archive.sign(one('--prepared', true)!, undefined, undefined, { authFlow: (one('--auth-flow') || 'normal') as any });
    else if (command === 'hide') result = await archive.hide(one('--record', true)!, switches.has('--retire-head'));
    else if (command === 'restore') result = await archive.restore(one('--record', true)!);
    else if (command === 'show') result = await archive.source(one('--record', true)!, one('--file', true)!);
    else if (command === 'history') result = await archive.history({ filePath: one('--file'), formalId: one('--formal-id') });
    else if (command === 'compare') {
        result = await archive.compare(one('--left', true)!, one('--right', true)!);
    } else if (command === 'export') {
        await writeExchangeFile(path.resolve(one('--out', true)!), await archive.export(one('--record'))); result = { exported: true, includesHiddenEvidence: !one('--record') };
    } else if (command === 'recover-lock') { await archive.policy(); await recoverLock(archive.directory); result = { recovered: true }; }
    else throw new Error('Unknown archive command.\n' + HELP);
    console.log(JSON.stringify(result, null, 2));
}
