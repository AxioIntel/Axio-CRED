(() => {
    'use strict';
    const form = document.getElementById('research-form');
    const result = document.getElementById('brief-result');
    const source = form.elements.source;
    const key = 'axiocred.research.brief.v1';
    const guidance = {
        websites: ['Business websites', 'Research services, locations and published contact details. Keep a source for every result.'],
        reddit: ['Reddit: access required', 'Useful for recurring complaints, product comparisons and brand mentions. A live connector requires Reddit approval and appropriate commercial access. No Reddit content is collected by this brief.'],
        practo: ['Practo: import available', 'Import an existing profile list from the Practo page. Live collection and AI matching are not connected yet.']
    };
    const presets = {
        clinics: {source:'websites', goal:'Find dermatology clinics in Bengaluru. Identify their published specialties, locations and business contact details.', fields:'Doctor, clinic, specialty, location, published business contact, source evidence'},
        reddit: {source:'reddit', goal:'Identify recurring complaints and product comparisons about appointment-booking software in relevant Reddit discussions.', fields:'Topic, recurring problem, product mentioned, date, discussion URL, supporting quote'},
        competitors: {source:'websites', goal:'Compare these businesses and identify changes in their published services, pricing and locations.', fields:'Business, service, published price, location, observed change, date, source evidence'}
    };
    function updateGuidance() {
        const [title, description] = guidance[source.value] || guidance.websites;
        const box = document.getElementById('source-guidance');
        box.querySelector('h2').textContent = title;
        box.querySelector('p').textContent = description;
    }
    function brief() {
        return {version:1, status:'draft', source:source.value, goal:form.elements.goal.value.trim(), links:form.elements.links.value.split('\n').map(s => s.trim()).filter(Boolean), fields:form.elements.fields.value.trim(), saved_at:new Date().toISOString()};
    }
    try {
        const saved = JSON.parse(localStorage.getItem(key));
        if (saved && saved.version === 1 && Object.hasOwn(guidance, saved.source)) {
            source.value = saved.source;
            for (const field of ['goal','fields']) if (typeof saved[field] === 'string') form.elements[field].value = saved[field];
            if (Array.isArray(saved.links)) form.elements.links.value = saved.links.filter(s => typeof s === 'string').join('\n');
            result.textContent = 'Your last saved brief is restored.';
        }
    } catch (_) { result.textContent = 'Browser storage is unavailable. You can still download your brief.'; }
    const requested = new URLSearchParams(location.search).get('source');
    if (Object.hasOwn(guidance, requested)) source.value = requested;
    source.addEventListener('change', updateGuidance);
    updateGuidance();
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        if (!brief().goal) { result.textContent = 'Describe what you want to learn.'; return; }
        try { localStorage.setItem(key, JSON.stringify(brief())); result.textContent = 'Brief saved in this browser. No collection or AI call was started.'; }
        catch (_) { result.textContent = 'Could not save in this browser. Download the brief instead.'; }
    });
    document.getElementById('download-brief').addEventListener('click', () => {
        if (!form.reportValidity() || !brief().goal) return;
        const href = URL.createObjectURL(new Blob([JSON.stringify(brief(), null, 2)], {type:'application/json'}));
        const link = document.createElement('a');
        link.href = href; link.download = 'axiocred-research-brief.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
        result.textContent = 'Brief downloaded. No collection or AI call was started.';
    });
    document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
        if ((form.elements.goal.value.trim() || form.elements.links.value.trim()) && !window.confirm('Replace the current brief with this example? Your saved brief will stay unchanged until you save again.')) return;
        const preset = presets[button.dataset.preset];
        for (const field of ['source','goal','fields']) form.elements[field].value = preset[field];
        form.elements.links.value = '';
        updateGuidance(); result.textContent = 'Example loaded. Edit it, then save your brief.';
        form.elements.goal.focus();
    }));
})();
