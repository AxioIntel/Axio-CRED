(() => {
    'use strict';
    const form = document.getElementById('practo-import');
    const output = document.getElementById('import-result');
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const file = form.elements.file.files[0];
        if (!file || file.size > 2 * 1024 * 1024) { output.textContent = 'Choose a CSV file under 2 MB.'; return; }
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true; output.textContent = 'Checking and importing profiles…';
        try {
            const response = await fetch('/practo/import', {method:'POST', body:new FormData(form)});
            if (!response.ok) { output.textContent = await response.text(); return; }
            const data = await response.json();
            output.textContent = `${data.imported} profile${data.imported === 1 ? '' : 's'} imported or updated. `;
            const link = document.createElement('a'); link.href = '/leads?source=practo'; link.textContent = 'View Practo leads'; output.appendChild(link);
            form.reset();
        } catch (_) { output.textContent = 'The connection was interrupted. Check Practo leads before retrying; importing the same profiles will not duplicate them.'; }
        finally { button.disabled = false; }
    });
})();
