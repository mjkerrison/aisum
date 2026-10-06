// Local stand-in for the Cloudflare runtime: serves ./public the way the assets layer
// does (clean URLs) and hands everything else to src/worker.js. No dependencies.
//
//   node dev/serve.mjs [port]
//
// Reads secrets from .dev.vars (KEY=VALUE per line, gitignored). Without them it uses
// Cloudflare's always-pass Turnstile test secret and logs Airtable writes instead of
// sending them.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const pub = join(root, 'public');
const port = Number(process.argv[2]) || 3000;

const env = {};
const varsFile = join(root, '.dev.vars');
if (existsSync(varsFile)) {
    for (const line of readFileSync(varsFile, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
        if (m) env[m[1]] = m[2];
    }
}
if (!env.TURNSTILE_SECRET) env.TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';
if (!env.AIRTABLE_TOKEN) {
    env.AIRTABLE_TOKEN = 'dry-run';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        if (String(input).startsWith('https://api.airtable.com/')) {
            console.log('[dry run] Airtable write:', init.body);
            return new Response('{"records":[{"id":"recDRYRUN"}]}', { status: 200 });
        }
        return realFetch(input, init);
    };
    console.log('No AIRTABLE_TOKEN in .dev.vars: Airtable writes are logged, not sent.');
}

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
    '.svg': 'image/svg+xml', '.ics': 'text/calendar', '.json': 'application/json'
};

function assetPath(pathname) {
    const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    const candidates = clean.endsWith('/')
        ? [join(pub, clean, 'index.html')]
        : [join(pub, clean), join(pub, clean + '.html')];
    return candidates.find(p => p.startsWith(pub) && existsSync(p) && statSync(p).isFile());
}

async function serveAsset(pathname) {
    const file = pathname === '/_redirects' ? null : assetPath(pathname);
    if (!file) return new Response('Not found', { status: 404 });
    return new Response(await readFile(file), {
        headers: { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }
    });
}

// Paths the Worker sees before the assets layer: keep in sync with run_worker_first in
// wrangler.jsonc. Open http://apply.localhost:3000 to see the apply-subdomain behaviour.
const WORKER_FIRST = ['/', '/apply'];

env.ASSETS = { fetch: request => serveAsset(new URL(request.url).pathname) };

createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const url = new URL(req.url, `${proto}://${host}`);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(url, { method: req.method, headers: req.headers, body: hasBody ? Buffer.concat(chunks) : undefined });

    let response;
    try {
        const direct = hasBody || WORKER_FIRST.includes(url.pathname) ? null : assetPath(url.pathname);
        response = direct ? await serveAsset(url.pathname) : await worker.fetch(request, env);
    } catch (e) {
        console.error(e);
        response = new Response('Worker threw', { status: 500 });
    }
    console.log(req.method, url.pathname, response.status);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '0.0.0.0', () => console.log(`aisum dev server on http://0.0.0.0:${port}`));
