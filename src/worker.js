// aisum.org Worker. Static pages are served from ./public by the assets layer; only
// requests that match no file get here. The one dynamic route is POST /api/apply, which
// validates an application, checks the Turnstile token and writes a row to Airtable.
//
// Secrets (set in the Cloudflare dashboard, never in this repo):
//   AIRTABLE_TOKEN    Airtable personal access token with data.records:write on the base
//   TURNSTILE_SECRET  secret key of the Turnstile widget whose site key is in apply.html

const AIRTABLE = {
    base: 'appjb6j9oCogXFtNz',
    table: 'tblyO6Sih9ptXrod1',
    // Form field -> column in the "AISUM26 Applications" table. Field IDs rather than
    // names, so renaming a column in Airtable doesn't break submissions.
    fields: {
        name: 'fldnPNT7R58VflEa5',          // Name
        email: 'fldH8HfQaTubd1Gcx',         // Email
        engagement: 'fld6BQn8FAWILrPUq',    // Engagement
        hoping: 'fldvyBJFTQ9DZSCzv',        // Hoping to get / contribute
        presence: 'fldeYGGygMIzo0Guf',      // Online presence
        volunteer: 'fldKmo3Dd4NxpPhhC',     // Volunteer
        anything_else: 'fld580MT4mqUgaQNe'  // Anything else
    },
    // Engagement answer -> single-select option, which must match Airtable's label exactly.
    // 1 is absent on purpose: those visitors get the soft-landing message and never submit.
    engagement: {
        '2': '2 (e.g. interested, reading lots)',
        '3': '3 (e.g. thinking about getting involved)',
        '4': '4 (e.g. looking to change career, volunteering)',
        '5': '5 (doing relevant work, contributing to projects)'
    }
};

const LIMITS = { name: 120, email: 200, hoping: 5000, presence: 500, anything_else: 3000 };
const MAX_BODY_BYTES = 32 * 1024;

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/api/apply') return apply(request, url, env);
        return env.ASSETS.fetch(request);
    }
};

function json(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
}

function text(input, max) {
    return typeof input === 'string' ? input.trim().slice(0, max + 1) : '';
}

// Returns { errors, fields }: per-field messages for the form, and the Airtable row.
export function validate(input) {
    const errors = {};
    const name = text(input.name, LIMITS.name);
    const email = text(input.email, LIMITS.email);
    const hoping = text(input.hoping, LIMITS.hoping);
    const presence = text(input.presence, LIMITS.presence);
    const anythingElse = text(input.anything_else, LIMITS.anything_else);
    const engagement = AIRTABLE.engagement[String(input.engagement)];

    if (!name) errors.name = 'Please tell us your name.';
    else if (name.length > LIMITS.name) errors.name = 'Please shorten this a little.';

    if (!email) errors.email = 'Please enter your email address.';
    else if (email.length > LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.email = "That doesn't look like an email address.";
    }

    if (!engagement) errors.engagement = 'Please pick the option that fits best.';

    if (!hoping) errors.hoping = "Please tell us what you're hoping to get out of or contribute.";
    else if (hoping.length > LIMITS.hoping) errors.hoping = 'Please shorten this: around 200 words is plenty.';

    if (!presence) errors.presence = 'Please add a link to your LinkedIn or another public profile.';
    else if (presence.length > LIMITS.presence) errors.presence = 'Please shorten this to a single link or two.';

    if (anythingElse.length > LIMITS.anything_else) errors.anything_else = 'Please shorten this a little.';

    const f = AIRTABLE.fields;
    const fields = {
        [f.name]: name,
        [f.email]: email,
        [f.engagement]: engagement,
        [f.hoping]: hoping,
        [f.presence]: presence,
        [f.volunteer]: input.volunteer === true
    };
    if (anythingElse) fields[f.anything_else] = anythingElse;
    return { errors, fields };
}

async function verifyTurnstile(token, request, env) {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            secret: env.TURNSTILE_SECRET,
            response: token,
            remoteip: request.headers.get('CF-Connecting-IP') || undefined
        })
    });
    if (!res.ok) return false;
    const outcome = await res.json();
    return outcome.success === true;
}

async function apply(request, url, env) {
    if (request.method !== 'POST') return json(405, { ok: false });
    if (!env.AIRTABLE_TOKEN || !env.TURNSTILE_SECRET) {
        console.error('apply: AIRTABLE_TOKEN or TURNSTILE_SECRET is not set');
        return json(500, { ok: false });
    }

    // Browsers always send Origin on a cross-site POST; only our own pages may submit.
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json(403, { ok: false });
    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) {
        return json(415, { ok: false });
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { ok: false });
    let input;
    try { input = JSON.parse(raw); } catch (e) { return json(400, { ok: false }); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json(400, { ok: false });

    // Honeypot: a filled hidden field means a bot. Pretend it worked and write nothing.
    if (input.website) return json(200, { ok: true });

    const { errors, fields } = validate(input);
    if (Object.keys(errors).length) return json(422, { ok: false, errors });

    const token = typeof input.turnstile_token === 'string' ? input.turnstile_token : '';
    if (!token || !(await verifyTurnstile(token, request, env))) {
        return json(403, { ok: false, error: 'verification' });
    }

    const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE.base}/${AIRTABLE.table}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields }] })
    });
    if (!res.ok) {
        // Log Airtable's reason (a schema or auth problem), never the applicant's answers.
        console.error('apply: Airtable write failed', res.status, (await res.text()).slice(0, 300));
        return json(502, { ok: false });
    }
    return json(200, { ok: true });
}
