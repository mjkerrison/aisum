// Run with: node --test dev/worker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const GOOD = {
    name: 'Ada Lovelace', email: 'ada@example.org', engagement: '4',
    hoping: 'Pitch a session on evals.', presence: 'https://linkedin.com/in/ada',
    volunteer: true, anything_else: '', website: '', turnstile_token: 'tok'
};
const env = { AIRTABLE_TOKEN: 'pat-test', TURNSTILE_SECRET: 'ts-test', ASSETS: { fetch: () => new Response('asset', { status: 404 }) } };

// Replaces global fetch for one call; records what the Worker sent upstream.
async function call(body, { method = 'POST', headers = {}, turnstile = true, airtable = 200, envOverride } = {}) {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).includes('turnstile')) return Response.json({ success: turnstile });
        return new Response(airtable === 200 ? '{"records":[{"id":"rec1"}]}' : '{"error":{"type":"UNKNOWN_FIELD_NAME"}}', { status: airtable });
    };
    try {
        const request = new Request('https://aisum.org/api/apply', {
            method,
            headers: { 'Content-Type': 'application/json', Origin: 'https://aisum.org', ...headers },
            body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
        });
        const res = await worker.fetch(request, envOverride || env);
        return { status: res.status, body: await res.json().catch(() => null), calls };
    } finally {
        globalThis.fetch = realFetch;
    }
}

test('valid application is written to Airtable', async () => {
    const r = await call(GOOD);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
    const airtable = r.calls.find(c => c.url.includes('airtable'));
    assert.equal(airtable.url, 'https://api.airtable.com/v0/appjb6j9oCogXFtNz/tblyO6Sih9ptXrod1');
    assert.equal(airtable.init.headers.Authorization, 'Bearer pat-test');
    const fields = JSON.parse(airtable.init.body).records[0].fields;
    assert.equal(fields.fldnPNT7R58VflEa5, 'Ada Lovelace');
    assert.equal(fields.fldKmo3Dd4NxpPhhC, true);
    assert.equal(fields.fld6BQn8FAWILrPUq, '4 (e.g. looking to change career, volunteering)');
    assert.ok(!('fld580MT4mqUgaQNe' in fields), 'empty optional field is omitted');
    assert.equal(Object.keys(fields).length, 6);
    assert.ok(!JSON.stringify(fields).includes('tok'), 'token is not stored');
});

test('missing and malformed fields come back as 422 with per-field errors', async () => {
    const r = await call({ ...GOOD, name: ' ', email: 'nope', hoping: '', presence: '' });
    assert.equal(r.status, 422);
    assert.deepEqual(Object.keys(r.body.errors).sort(), ['email', 'hoping', 'name', 'presence']);
    assert.equal(r.calls.length, 0, 'nothing sent upstream');
});

test('engagement 1 and unknown values are rejected', async () => {
    for (const engagement of ['1', '6', '', null, 4.5]) {
        const r = await call({ ...GOOD, engagement });
        assert.equal(r.status, 422, String(engagement));
        assert.ok(r.body.errors.engagement);
    }
});

test('over-long answers are rejected, not truncated', async () => {
    const r = await call({ ...GOOD, hoping: 'x'.repeat(5001) });
    assert.equal(r.status, 422);
    assert.ok(r.body.errors.hoping);
});

test('unknown extra fields never reach Airtable', async () => {
    const r = await call({ ...GOOD, Decision: 'Accepted', Comments: 'sneaky' });
    const fields = JSON.parse(r.calls.find(c => c.url.includes('airtable')).init.body).records[0].fields;
    assert.ok(!('Decision' in fields) && !('Comments' in fields));
    assert.equal(Object.keys(fields).length, 6);
});

test('honeypot submissions get a fake success and write nothing', async () => {
    const r = await call({ ...GOOD, website: 'http://spam.example' });
    assert.equal(r.status, 200);
    assert.equal(r.calls.length, 0);
});

test('failed or missing Turnstile token is a 403 and writes nothing', async () => {
    const failed = await call(GOOD, { turnstile: false });
    assert.equal(failed.status, 403);
    assert.ok(!failed.calls.some(c => c.url.includes('airtable')));
    const missing = await call({ ...GOOD, turnstile_token: '' });
    assert.equal(missing.status, 403);
    assert.equal(missing.calls.length, 0);
});

test('cross-origin, wrong method, wrong content type, bad JSON, oversize', async () => {
    assert.equal((await call(GOOD, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await call(null, { method: 'GET' })).status, 405);
    assert.equal((await call(GOOD, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await call('{not json')).status, 400);
    assert.equal((await call('[1,2]')).status, 400);
    assert.equal((await call({ ...GOOD, anything_else: 'x'.repeat(40000) })).status, 413);
});

test('Airtable failure surfaces as 502', async () => {
    const r = await call(GOOD, { airtable: 422 });
    assert.equal(r.status, 502);
    assert.deepEqual(r.body, { ok: false });
});

test('missing secrets fail closed', async () => {
    const r = await call(GOOD, { envOverride: { ...env, TURNSTILE_SECRET: undefined } });
    assert.equal(r.status, 500);
    assert.equal(r.calls.length, 0);
});

test('other paths fall through to static assets', async () => {
    const res = await worker.fetch(new Request('https://aisum.org/nope'), env);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), 'asset');
});

// Asset layer stand-in that echoes the path it was asked for.
const echoEnv = { ...env, ASSETS: { fetch: request => new Response(new URL(request.url).pathname) } };

test('apply subdomain serves the form at its root', async () => {
    const res = await worker.fetch(new Request('https://apply.aisum.org/'), echoEnv);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '/apply');

    const dupe = await worker.fetch(new Request('https://apply.aisum.org/apply'), echoEnv);
    assert.equal(dupe.status, 302);
    assert.equal(dupe.headers.get('Location'), 'https://apply.aisum.org/');

    const faqs = await worker.fetch(new Request('https://apply.aisum.org/faqs'), echoEnv);
    assert.equal(await faqs.text(), '/faqs');
});

test('aisum.org/apply forwards to the subdomain; the home page is untouched', async () => {
    const res = await worker.fetch(new Request('https://aisum.org/apply?ref=x'), echoEnv);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('Location'), 'https://apply.aisum.org/?ref=x');

    const home = await worker.fetch(new Request('https://aisum.org/'), echoEnv);
    assert.equal(await home.text(), '/');
});

test('hosts with no apply subdomain keep serving the form at /apply', async () => {
    const res = await worker.fetch(new Request('https://aisum.example.workers.dev/apply'), echoEnv);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '/apply');
});

test('applications posted from the subdomain are accepted', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async url => String(url).includes('turnstile')
        ? Response.json({ success: true })
        : new Response('{"records":[{"id":"rec1"}]}');
    try {
        const res = await worker.fetch(new Request('https://apply.aisum.org/api/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://apply.aisum.org' },
            body: JSON.stringify(GOOD)
        }), env);
        assert.equal(res.status, 200);
    } finally {
        globalThis.fetch = realFetch;
    }
});
