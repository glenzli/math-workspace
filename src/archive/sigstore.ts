import type { ArchiveAuthentication, ArchiveBundleInfo, ArchiveIdentity, ArchiveVerifier } from './types';
import { digest, exists, sha256 } from './io';
import * as path from 'node:path';
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const { URL } = require('node:url');

export function runProcess(command: string, args: string[], options: { input?: any; timeout?: number; stream?: boolean; cwd?: string; onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
        let output = '', errorOutput = '', overflow = false;
        const timer = setTimeout(() => child.kill('SIGTERM'), options.timeout || 30000);
        child.stdout.on('data', chunk => { output += String(chunk); if (options.stream) process.stderr.write(chunk); options.onOutput?.(String(chunk), 'stdout'); if (output.length > 8 * 1024 * 1024) { overflow = true; child.kill(); } });
        child.stderr.on('data', chunk => { errorOutput = (errorOutput + String(chunk)).slice(-16000); if (options.stream) process.stderr.write(chunk); options.onOutput?.(String(chunk), 'stderr'); });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => { clearTimeout(timer); code === 0 && !overflow ? resolve(output) : reject(new Error(`${command} did not complete (${code}): ${errorOutput}`)); });
        child.stdin.on('error', () => {}); child.stdin.end(options.input);
    });
}
/** Only the public device handoff is exposed; raw process output never enters Reader jobs. */
export function deviceAuthentication(output: string): ArchiveAuthentication | undefined {
    const pattern = /Enter the verification code ([A-Z0-9-]{4,32}) in your browser at:\s*(https:\/\/[^\s]+)[\r\n]/g;
    for (const match of output.matchAll(pattern)) {
        try {
            const url = new URL(match[2]);
            if (url.origin !== 'https://oauth2.sigstore.dev' || url.pathname !== '/auth/device'
                || url.username || url.password || url.searchParams.get('user_code') !== match[1]) continue;
            return { url: `https://oauth2.sigstore.dev/auth/device?user_code=${encodeURIComponent(match[1])}`, code: match[1] };
        } catch (_) { /* Ignore unrelated or incomplete process output. */ }
    }
}
export function sameIdentity(a: ArchiveIdentity, b: ArchiveIdentity): boolean { return a?.identity === b?.identity && a?.issuer === b?.issuer; }
export function validIdentity(value: any): ArchiveIdentity {
    if (!value || typeof value.identity !== 'string' || !value.identity || value.identity.length > 512
        || typeof value.issuer !== 'string' || !/^https:\/\//.test(value.issuer) || value.issuer.length > 512) throw new Error('A signing identity and HTTPS OIDC issuer are required.');
    return { identity: value.identity, issuer: value.issuer };
}
export class SigstoreVerifier implements ArchiveVerifier {
    private readonly inspected = new Map<string, ArchiveBundleInfo>();
    private readonly verified = new Map<string, ArchiveBundleInfo>();
    constructor(readonly trustedRoot?: string) {}

    async inspect(data: any): Promise<ArchiveBundleInfo> {
        const key = sha256(data); const cached = this.inspected.get(key); if (cached) return cached;
        const bundle = JSON.parse(data.toString('utf8'));
        const message = bundle?.messageSignature?.messageDigest;
        if (message?.algorithm !== 'SHA2_256') throw new Error('A SHA2_256 Sigstore message-signature bundle is required.');
        const material = bundle.verificationMaterial;
        const certificate = Buffer.from(material.certificate.rawBytes, 'base64');
        const text = await runProcess('openssl', ['x509', '-inform', 'DER', '-text', '-noout'], { input: certificate });
        const identity = text.match(/(?:email:|URI:)([^\s,]+)/)?.[1];
        const issuer = text.match(/1\.3\.6\.1\.4\.1\.57264\.1\.1:\s*\n\s*(\S+)/)?.[1];
        const times = (material.tlogEntries || []).map(item => Number(item.integratedTime)).filter(time => Number.isSafeInteger(time) && time > 0);
        const info: ArchiveBundleInfo = {
            digest: digest(Buffer.from(message.digest, 'base64').toString('hex')),
            identity: validIdentity({ identity, issuer }),
            loggedAt: times.length ? new Date(Math.min(...times) * 1000).toISOString() : null,
            timestampCount: material.timestampVerificationData?.rfc3161Timestamps?.length || 0
        };
        this.inspected.set(key, info); return info;
    }

    async verify(payload: any, bundle: any, identities: ArchiveIdentity[]): Promise<ArchiveBundleInfo> {
        const info = await this.inspect(bundle);
        if (sha256(payload) !== info.digest) throw new Error('The bundle does not sign these payload bytes.');
        if (!identities.some(identity => sameIdentity(identity, info.identity))) throw new Error('The signing identity is not accepted by this project.');
        const trustBytes = this.trustedRoot ? await fs.readFile(this.trustedRoot) : Buffer.from('cosign-default-trust');
        const key = [sha256(payload), sha256(bundle), sha256(trustBytes)].join(':');
        if (this.verified.has(key)) return this.verified.get(key)!;
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'math-archive-verify-'));
        try {
            await fs.writeFile(path.join(directory, 'payload'), payload);
            await fs.writeFile(path.join(directory, 'bundle'), bundle);
            const args = ['verify-blob', path.join(directory, 'payload'), '--bundle', path.join(directory, 'bundle'),
                '--certificate-identity', info.identity.identity, '--certificate-oidc-issuer', info.identity.issuer,
                '--use-signed-timestamps', '--timeout', '20s'];
            if (this.trustedRoot) args.push('--trusted-root', this.trustedRoot);
            await runProcess('cosign', args);
            this.verified.set(key, info); return info;
        } finally { await fs.rm(directory, { recursive: true, force: true }); }
    }
}
export async function defaultVerifier(explicit?: string): Promise<SigstoreVerifier> {
    const requested = explicit || process.env.MATH_WORKSPACE_SIGSTORE_TRUSTED_ROOT;
    if (requested && !await exists(requested)) throw new Error('The configured Sigstore trusted-root file does not exist.');
    const cached = path.join(os.homedir(), '.sigstore/root/tuf-repo-cdn.sigstore.dev/targets/trusted_root.json');
    return new SigstoreVerifier(requested || (await exists(cached) ? cached : undefined));
}
