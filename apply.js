// AISUM26 application form.
// Two steps (About you -> About the Unconference). An engagement answer of 1 short-circuits
// to a soft-landing panel instead of step 2. Answers are kept in localStorage until the
// application is submitted, so a refresh or a failed submit never loses them.
(function () {
    var ENDPOINT = '/api/apply';
    var DRAFT_KEY = 'aisum26-apply-draft';
    var WORD_GUIDE = 200;
    var FIELDS = ['name', 'email', 'engagement', 'hoping', 'presence', 'anything_else'];
    var STEP_FIELDS = {
        you: ['name', 'email', 'engagement'],
        unconference: ['hoping', 'presence']
    };

    var form = document.getElementById('apply-form');
    if (!form) return;
    var soft = document.getElementById('apply-soft');
    var done = document.getElementById('apply-done');
    var submitBtn = document.getElementById('apply-submit');
    var submitError = document.getElementById('apply-submit-error');
    var draftNote = document.getElementById('apply-draft-note');
    var counter = document.getElementById('count-hoping');
    var submissionId = newId();
    var softSent = false;

    form.hidden = false;

    // ---- values ----

    function value(name) {
        if (name === 'engagement') {
            var checked = form.querySelector('input[name="engagement"]:checked');
            return checked ? checked.value : '';
        }
        return (form.elements[name].value || '').trim();
    }

    function values() {
        var out = {};
        FIELDS.forEach(function (name) { out[name] = value(name); });
        return out;
    }

    function wordCount(text) {
        var words = text.trim().match(/\S+/g);
        return words ? words.length : 0;
    }

    function newId() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    }

    // ---- validation ----

    function check(name) {
        var v = value(name);
        switch (name) {
            case 'name':
                return v ? '' : 'Please tell us your name.';
            case 'email':
                if (!v) return 'Please enter your email address.';
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : "That doesn't look like an email address.";
            case 'engagement':
                return v ? '' : 'Please pick the option that fits best.';
            case 'hoping':
                return v ? '' : "Please tell us what you're hoping to get out of or contribute.";
            case 'presence':
                return v ? '' : 'Please add a link to your LinkedIn or another public profile.';
        }
        return '';
    }

    function setError(name, message) {
        var field = form.querySelector('[data-field="' + name + '"]');
        var err = document.getElementById('err-' + name);
        if (!field || !err) return;
        field.classList.toggle('has-error', !!message);
        err.textContent = message || '';
        err.hidden = !message;
        var input = name === 'engagement' ? null : form.elements[name];
        if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }

    function validateStep(step) {
        var firstBad = null;
        STEP_FIELDS[step].forEach(function (name) {
            var message = check(name);
            setError(name, message);
            if (message && !firstBad) firstBad = name;
        });
        if (firstBad) {
            var target = firstBad === 'engagement'
                ? form.querySelector('input[name="engagement"]')
                : form.elements[firstBad];
            target.focus();
        }
        return !firstBad;
    }

    // Once a field has shown an error, re-check it as the answer changes.
    form.addEventListener('input', function (e) {
        var name = e.target.name;
        if (!name) return;
        var field = form.querySelector('[data-field="' + name + '"]');
        if (field && field.classList.contains('has-error')) setError(name, check(name));
        if (name === 'hoping') updateCount();
        saveDraft();
    });

    form.addEventListener('focusout', function (e) {
        var name = e.target.name;
        if (name === 'email' && value('email')) setError('email', check('email'));
    });

    function updateCount() {
        var n = wordCount(form.elements.hoping.value);
        counter.textContent = n + (n === 1 ? ' word' : ' words') +
            (n > WORD_GUIDE ? ' (over the suggested ' + WORD_GUIDE + ')' : '');
        counter.classList.toggle('is-over', n > WORD_GUIDE);
    }

    // ---- views ----

    function show(view, opts) {
        opts = opts || {};
        var inForm = view === 'you' || view === 'unconference';
        form.hidden = !inForm;
        soft.hidden = view !== 'soft';
        done.hidden = view !== 'done';
        var title = null;
        if (inForm) {
            Array.prototype.forEach.call(form.querySelectorAll('[data-panel]'), function (panel) {
                var on = panel.getAttribute('data-panel') === view;
                panel.hidden = !on;
                if (on) title = panel.querySelector('.apply-panel-title');
            });
            Array.prototype.forEach.call(form.querySelectorAll('[data-step-marker]'), function (marker) {
                var key = marker.getAttribute('data-step-marker');
                marker.classList.toggle('is-current', key === view);
                marker.classList.toggle('is-done', key === 'you' && view === 'unconference');
                if (key === view) marker.setAttribute('aria-current', 'step');
                else marker.removeAttribute('aria-current');
            });
        } else {
            title = (view === 'soft' ? soft : done).querySelector('.apply-panel-title');
        }
        if (opts.push) history.pushState({ view: view }, '');
        if (opts.focus !== false && title) {
            title.focus({ preventScroll: true });
            var top = document.querySelector('.apply-card').getBoundingClientRect().top + window.scrollY - 16;
            if (window.scrollY > top) window.scrollTo({ top: top, behavior: 'smooth' });
        }
    }

    // Browser Back steps back through the form rather than leaving the page.
    history.replaceState({ view: 'you' }, '');
    window.addEventListener('popstate', function (e) {
        if (!done.hidden) return;
        show((e.state && e.state.view) || 'you');
    });

    form.addEventListener('click', function (e) {
        var action = e.target.getAttribute && e.target.getAttribute('data-action');
        if (action === 'next') {
            if (!validateStep('you')) return;
            if (value('engagement') === '1') {
                show('soft', { push: true });
                sendSoftLanding();
            } else {
                show('unconference', { push: true });
            }
            saveDraft();
        } else if (action === 'back') {
            history.back();
        }
    });

    // Enter in a step-1 text field means Continue, not submit.
    form.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
        var panel = e.target.closest('[data-panel]');
        if (panel && panel.getAttribute('data-panel') === 'you') {
            e.preventDefault();
            panel.querySelector('[data-action="next"]').click();
        }
    });

    document.getElementById('apply-soft-back').addEventListener('click', function () {
        history.back();
    });

    // ---- draft ----

    function saveDraft() {
        try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: submissionId, values: values() }));
        } catch (e) { /* storage unavailable: carry on without drafts */ }
    }

    function clearDraft() {
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    }

    function restoreDraft() {
        var draft;
        try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return; }
        if (!draft || !draft.values) return;
        var any = false;
        FIELDS.forEach(function (name) {
            var v = draft.values[name];
            if (!v) return;
            any = true;
            if (name === 'engagement') {
                var radio = form.querySelector('input[name="engagement"][value="' + String(v).replace(/"/g, '') + '"]');
                if (radio) radio.checked = true;
            } else {
                form.elements[name].value = v;
            }
        });
        if (draft.id) submissionId = draft.id;
        if (any) draftNote.hidden = false;
    }

    document.getElementById('apply-clear-draft').addEventListener('click', function () {
        clearDraft();
        form.reset();
        submissionId = newId();
        softSent = false;
        FIELDS.forEach(function (name) { setError(name, ''); });
        updateCount();
        draftNote.hidden = true;
        show('you');
    });

    // ---- submit ----

    function post(payload) {
        return fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (body) {
                return { status: res.status, ok: res.ok && body.ok !== false, body: body };
            });
        });
    }

    function payload(stage) {
        var v = values();
        v.stage = stage;
        v.submission_id = submissionId;
        v.website = form.elements.website.value;
        return v;
    }

    // Engagement = 1: note the interest in the background. Nothing on screen depends on it.
    function sendSoftLanding() {
        if (softSent) return;
        softSent = true;
        post(payload('soft_landing')).catch(function () { softSent = false; });
    }

    function showSubmitError(html) {
        submitError.innerHTML = html;
        submitError.hidden = false;
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        submitError.hidden = true;
        // Step 1 answers can be stale if someone edits a restored draft.
        if (!validateStep('you')) { show('you', { focus: false }); validateStep('you'); return; }
        if (!validateStep('unconference')) return;

        submitBtn.disabled = true;
        var label = submitBtn.textContent;
        submitBtn.textContent = 'Submitting…';

        post(payload('application')).then(function (res) {
            if (res.ok) {
                document.getElementById('apply-done-name').textContent = value('name').split(/\s+/)[0];
                document.getElementById('apply-done-email').textContent = value('email');
                clearDraft();
                history.replaceState({ view: 'done' }, '');
                show('done');
                return;
            }
            var errors = res.body && res.body.errors;
            if (res.status === 422 && errors) {
                var first = null;
                Object.keys(errors).forEach(function (name) {
                    setError(name, errors[name]);
                    if (!first) first = name;
                });
                if (first && STEP_FIELDS.you.indexOf(first) !== -1) show('you');
                showSubmitError('Some answers need another look. Please check the highlighted fields.');
                return;
            }
            throw new Error('submit failed: ' + res.status);
        }).catch(function () {
            showSubmitError(
                "Sorry, that didn't go through. Your answers are saved on this device, so please try again in a minute. " +
                'If it keeps happening, email <a href="mailto:michael.kerrison@aisafetyanz.com.au?subject=AISUM26%20application">michael.kerrison@aisafetyanz.com.au</a>.'
            );
        }).then(function () {
            submitBtn.disabled = false;
            submitBtn.textContent = label;
        });
    });

    restoreDraft();
    updateCount();
})();
