function showModal(options) {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-modal'); const titleEl = document.getElementById('modal-title'); const textEl = document.getElementById('modal-text');
        const formEl = document.getElementById('modal-form'); const cancelBtn = document.getElementById('modal-cancel'); const confirmBtn = document.getElementById('modal-confirm');

        titleEl.innerText = options.title || 'Attention';
        if (options.content) { textEl.innerText = options.content; textEl.classList.remove('hidden'); } else { textEl.classList.add('hidden'); }
        formEl.innerHTML = '';

        if (options.type === 'form') {
            options.fields.forEach(f => {
                const wrapper = document.createElement('div'); wrapper.innerHTML = `<label class="block text-xs font-semibold text-textMuted mb-1">${f.label}</label>`;
                let input;
                if(f.type === 'select') { input = document.createElement('select'); input.innerHTML = f.options.map(o => `<option value="${o}" ${f.defaultValue === o ? 'selected' : ''}>${o}</option>`).join(''); } 
                else { input = document.createElement('input'); input.type = f.type || 'text'; if(f.placeholder) input.placeholder = f.placeholder; if(f.defaultValue) input.value = f.defaultValue; }
                input.id = `modal-input-${f.id}`; input.className = 'w-full bg-black/20 border border-borderDark rounded-lg px-4 py-3 md:px-3 md:py-2 text-textMain outline-none focus:border-accent text-base md:text-sm transition shadow-inner';
                wrapper.appendChild(input); formEl.appendChild(wrapper);
            });
            if (typeof initCustomSelects === 'function') initCustomSelects(formEl);
            setTimeout(() => formEl.querySelector('input, select:not(.hidden), .csel-btn')?.focus(), 50);
        }

        modal.classList.remove('hidden');
        const cleanup = () => { modal.classList.add('hidden'); cancelBtn.onclick = null; confirmBtn.onclick = null; };

        cancelBtn.onclick = () => { cleanup(); resolve(null); };
        confirmBtn.onclick = () => {
            cleanup();
            if (options.type === 'form') { const result = {}; options.fields.forEach(f => result[f.id] = document.getElementById(`modal-input-${f.id}`).value); resolve(result); } 
            else resolve(true);
        };
    });
}

// toast() is defined once in the 10X Enhancement Pack section below,
// using the #toast-container stack. Do not redeclare here.

