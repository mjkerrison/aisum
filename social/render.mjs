// Renders social/cards.html into PNGs under social/out/ with headless Chrome, driven over
// the DevTools protocol so each image is exactly the size asked for. No dependencies.
//
//   node social/render.mjs
//
// Feed images come out at 2x their nominal size (e.g. 2400x1260 for landscape) so they
// stay sharp after the platforms recompress them. og.png is the 1x landscape announce
// card and is also copied to public/ for link previews.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = join(here, 'out');
const SIZES = { landscape: [1200, 630, 2], square: [1080, 1080, 2], story: [1080, 1920, 1] };
const CARDS = ['announce', 'theme'];

function findChrome() {
    if (process.env.CHROME) return process.env.CHROME;
    const cache = join(process.env.HOME, '.cache/ms-playwright');
    const dirs = existsSync(cache) ? readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort() : [];
    const found = dirs.map(d => join(cache, d, 'chrome-linux64/chrome')).filter(existsSync).pop();
    if (!found) throw new Error('No Chrome found; set CHROME=/path/to/chrome');
    return found;
}

const port = 9340;
const profile = mkdtempSync(join(tmpdir(), 'aisum-social-'));
const chrome = spawn(findChrome(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
    let targets;
    for (let i = 0; i < 40 && !targets; i++) {
        try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch (e) { await sleep(250); }
    }
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    let id = 0;
    const pending = new Map();
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise(res => { pending.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });

    async function shot(card, size, scale, file) {
        const [width, height] = SIZES[size];
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
        await send('Page.navigate', { url: `file://${here}cards.html?card=${card}&size=${size}` });
        // Wait for the web font, or the text is measured and drawn in the fallback face.
        await send('Runtime.evaluate', {
            expression: '(document.readyState === "complete" ? Promise.resolve() : new Promise(r => addEventListener("load", r, { once: true }))).then(() => document.fonts.ready).then(() => 1)',
            awaitPromise: true
        });
        await sleep(300);
        const png = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(out, file), Buffer.from(png.result.data, 'base64'));
        console.log(' ', file, `${width * scale}x${height * scale}`);
    }

    mkdirSync(out, { recursive: true });
    await send('Page.enable');
    for (const card of CARDS) {
        for (const size of Object.keys(SIZES)) await shot(card, size, SIZES[size][2], `aisum26-${card}-${size}.png`);
    }
    await shot('announce', 'landscape', 1, 'og.png');
    copyFileSync(join(out, 'og.png'), join(here, '../public/og.png'));
    ws.close();
} finally {
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
}
