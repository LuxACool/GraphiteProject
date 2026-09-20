/* --- FLASHCARDS (3D Flip & Markdown) --- */
let srsDeck = []; let currentCard = null; let isCardFlipped = false;

function addFlashcard() {
    const modal = document.getElementById('add-card-modal');
    if (!modal) return;
    // Reset fields
    document.getElementById('act-q').value = '';
    document.getElementById('act-a').value = '';
    document.getElementById('act-options').value = '';
    document.getElementById('act-type').value = 'basic';
    if (typeof syncCustomSelects === 'function') syncCustomSelects(modal);
    document.getElementById('act-options-wrap').style.display = 'none';
    document.getElementById('act-ai-result').classList.add('hidden');
    switchAddCardTab('manual');
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('act-q').focus(), 80);
}
function closeAddCardModal() {
    document.getElementById('add-card-modal').classList.add('hidden');
}
function switchAddCardTab(tab) {
    document.getElementById('act-panel-manual').classList.toggle('hidden', tab !== 'manual');
    document.getElementById('act-panel-ai').classList.toggle('hidden', tab !== 'ai');
    document.getElementById('act-tab-manual').className = 'flex-1 py-1.5 text-xs font-semibold rounded-md transition ' + (tab === 'manual' ? 'bg-accent text-white' : 'text-textMuted');
    document.getElementById('act-tab-ai').className = 'flex-1 py-1.5 text-xs font-semibold rounded-md transition ' + (tab === 'ai' ? 'bg-accent text-white' : 'text-textMuted');
}
function submitManualCard() {
    const q = document.getElementById('act-q').value.trim();
    const a = document.getElementById('act-a').value.trim();
    if (!q || !a) { toast('Please fill in the question and answer.', 'error'); return; }
    const isMCQ = document.getElementById('act-type').value === 'mcq';
    let card = { id: Date.now().toString(), q, a, rep: 0, int: 1, ef: 2.5, next: Date.now(), workspaceId: state.activeWorkspace };
    if (isMCQ) {
        const opts = document.getElementById('act-options').value.split(',').map(o => o.trim()).filter(Boolean);
        if (opts.length >= 2) { card.type = 'mcq'; card.options = opts; const match = opts.find(o => o.toLowerCase() === a.toLowerCase()); if (match) card.a = match; }
    }
    state.flashcards.push(card);
    saveDataToDB(); updateFlashcardUI();
    closeAddCardModal();
    toast('Card added!', 'success');
}
// Show/hide MCQ options field based on type selection
document.addEventListener('change', function(e) {
    if (e.target.id === 'act-type') {
        document.getElementById('act-options-wrap').style.display = e.target.value === 'mcq' ? 'block' : 'none';
    }
});
async function submitAIGenerate() {
    const type = document.getElementById('act-ai-type').value;
    const source = document.getElementById('act-ai-source').value;
    const count = parseInt(document.getElementById('act-ai-count').value) || 10;
    const btn = document.getElementById('act-ai-btn');
    const icon = document.getElementById('act-ai-icon');
    const resultEl = document.getElementById('act-ai-result');
    // Reuse tutorGenerateCards logic by temporarily syncing the cg-* selects if present
    const cgType = document.getElementById('cg-type');
    const cgSource = document.getElementById('cg-source');
    const cgCount = document.getElementById('cg-count');
    if (cgType) cgType.value = type;
    if (cgSource) cgSource.value = source;
    if (cgCount) cgCount.value = count;
    btn.disabled = true; icon.textContent = '⏳';
    resultEl.classList.add('hidden');
    try {
        await tutorGenerateCards();
        resultEl.textContent = '✓ Cards generated and added to your deck!';
        resultEl.classList.remove('hidden');
        setTimeout(closeAddCardModal, 1400);
    } catch(e) {
        resultEl.textContent = '✗ Generation failed. Try again.';
        resultEl.classList.remove('hidden');
    }
    btn.disabled = false; icon.textContent = '✦';
}

let srsBatchLimit = 10; // default 10 questions per session

function setSRSBatch(n) {
    srsBatchLimit = n;
    document.querySelectorAll('.batch-btn').forEach(b => b.classList.remove('srs-batch-active', 'text-accent'));
    const btn = document.getElementById(`batch-btn-${n}`);
    if (btn) btn.classList.add('srs-batch-active', 'text-accent');
    const inp = document.getElementById('custom-batch-input');
    if (inp) inp.value = '';
    updateFlashcardUI();
}

function applyCustomBatch() {
    const inp = document.getElementById('custom-batch-input');
    const val = parseInt(inp.value);
    if (!val || val < 1) { toast('Enter a number between 1–200.', 'error'); return; }
    srsBatchLimit = val;
    document.querySelectorAll('.batch-btn').forEach(b => b.classList.remove('srs-batch-active', 'text-accent'));
    updateFlashcardUI();
    toast(`Session set to ${val} questions.`);
}

let fcNavIndex = 0; // current browse index within srsDeck

function updateFlashcardUI() {
    const now = Date.now();
    const allDue = state.flashcards.filter(c => c.workspaceId === state.activeWorkspace && c.next <= now);
    srsDeck = srsBatchLimit >= 999 ? allDue : allDue.slice(0, srsBatchLimit);
    document.getElementById('srs-status').innerText = `${srsDeck.length} of ${allDue.length} cards due today.`;
    fcNavIndex = 0;
    _renderFCCard();
}

function _renderFCCard() {
    const frontEl = document.getElementById('fc-front-content');
    const innerWrap = document.getElementById('fc-inner');
    const controls = document.getElementById('srs-controls');
    const navStatus = document.getElementById('fc-nav-status');
    const hintEl = document.getElementById('fc-hint-text');
    const stack1 = document.getElementById('fc-stack-1');
    const stack2 = document.getElementById('fc-stack-2');

    // Reset flip
    innerWrap.style.transform = 'rotateY(0deg)';
    isCardFlipped = false;
    controls.classList.add('hidden'); controls.classList.remove('flex');

    // Stack depth visuals
    if (stack1) stack1.style.opacity = srsDeck.length > 1 ? '0.6' : '0';
    if (stack2) stack2.style.opacity = srsDeck.length > 2 ? '0.3' : '0';

    if (srsDeck.length === 0) {
        currentCard = null;
        frontEl.innerHTML = "No cards due. You're all caught up! 🎉";
        if (navStatus) navStatus.textContent = '0 / 0';
        { const pb = document.getElementById('fc-progress-bar'); if (pb) pb.style.width = '0%'; }
        if (hintEl) hintEl.textContent = '';
        document.getElementById('flashcard-container').classList.remove('cursor-pointer');
        return;
    }

    if (navStatus) navStatus.textContent = `${fcNavIndex + 1} / ${srsDeck.length}`;
    { const pb = document.getElementById('fc-progress-bar'); if (pb) pb.style.width = (((fcNavIndex + 1) / srsDeck.length) * 100) + '%'; }
    document.getElementById('flashcard-container').classList.add('cursor-pointer');
    currentCard = srsDeck[fcNavIndex];

    // MCQ card — render options inline on the front
    if (currentCard.type === 'mcq' && currentCard.options) {
        if (hintEl) hintEl.textContent = 'Select an answer';
        document.getElementById('flashcard-container').onclick = null; // disable flip-on-click for MCQ
        let html = `<div class="mb-4 text-left w-full">${currentCard.q.split('\n').join('<br>')}</div>`;
        html += `<div class="flex flex-col gap-2 w-full max-w-sm mx-auto mt-2">`;
        currentCard.options.forEach(opt => {
            const safe = opt.replace(/'/g, "\'").replace(/"/g, '&quot;');
            html += `<div onclick="fcCheckMCQ(event,'${safe}')" data-opt="${safe}"
                class="fcmcq-opt border border-borderDark rounded-xl p-3 text-sm font-medium text-left text-textMain bg-bgDark hover:border-accent hover:bg-accent/5 cursor-pointer flex justify-between items-center transition-all">
                <span>${opt}</span><span class="fcmcq-icon w-5 h-5 flex items-center justify-center"></span>
            </div>`;
        });
        html += `</div>`;
        frontEl.innerHTML = html;
        // Clear back
        document.getElementById('fc-back-content').innerHTML = '';
    } else {
        // Basic flashcard
        if (hintEl) hintEl.textContent = 'Click card to flip';
        document.getElementById('flashcard-container').onclick = flipCard;
        frontEl.innerHTML = renderMarkdownWithMath(currentCard.q);
        renderMathInElement(frontEl, { delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}], throwOnError: false });
    }
    renderCardMeta(currentCard);
}

function fcCheckMCQ(e, selected) {
    e.stopPropagation();
    if (currentCard._mcqAnswered) return;
    currentCard._mcqAnswered = true;
    const correct = currentCard.a.trim();
    document.querySelectorAll('.fcmcq-opt').forEach(el => {
        const opt = el.getAttribute('data-opt').trim();
        const icon = el.querySelector('.fcmcq-icon');
        el.onclick = null;
        el.classList.remove('hover:border-accent', 'hover:bg-accent/5', 'cursor-pointer');
        if (opt === correct) {
            el.classList.add('border-mint', 'bg-mint/10', 'text-mint');
            if (icon) icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="text-mint w-4 h-4"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        } else if (opt === selected.trim() && selected.trim() !== correct) {
            el.classList.add('border-red-500', 'bg-red-500/10', 'text-red-400');
            if (icon) icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="text-red-400 w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        } else {
            el.style.opacity = '0.45';
        }
    });
    // Auto-advance after 1.5s
    setTimeout(() => {
        currentCard._mcqAnswered = false;
        fcNextCard();
    }, 1600);
}

function fcNextCard() {
    if (srsDeck.length === 0) return;
    // If current is a basic flashcard and not yet flipped, flip back first then advance
    if (isCardFlipped) {
        document.getElementById('fc-inner').style.transform = 'rotateY(0deg)';
        isCardFlipped = false;
        document.getElementById('srs-controls').classList.add('hidden');
        document.getElementById('srs-controls').classList.remove('flex');
        setTimeout(() => {
            fcNavIndex = (fcNavIndex + 1) % srsDeck.length;
            _renderFCCard();
        }, 320);
    } else {
        fcNavIndex = (fcNavIndex + 1) % srsDeck.length;
        _renderFCCard();
    }
}

function fcPrevCard() {
    if (srsDeck.length === 0) return;
    if (isCardFlipped) {
        document.getElementById('fc-inner').style.transform = 'rotateY(0deg)';
        isCardFlipped = false;
        document.getElementById('srs-controls').classList.add('hidden');
        document.getElementById('srs-controls').classList.remove('flex');
        setTimeout(() => {
            fcNavIndex = (fcNavIndex - 1 + srsDeck.length) % srsDeck.length;
            _renderFCCard();
        }, 320);
    } else {
        fcNavIndex = (fcNavIndex - 1 + srsDeck.length) % srsDeck.length;
        _renderFCCard();
    }
}

function renderCardMeta(card){
    const ef = (card.ef || 2.5).toFixed(2);
    const rep = card.rep || 0;
    const leech = card.leech ? '<span class="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30" title="Leech: marked wrong 5+ times this week">🪤 Leech</span>' : '';
    // Color EF: red < 1.8, orange < 2.2, mint >= 2.2
    const efNum = parseFloat(ef);
    const efColor = efNum < 1.8 ? 'text-red-400' : efNum < 2.2 ? 'text-orange-400' : 'text-mint';
    const html = `${leech}<span class="px-1.5 py-0.5 rounded bg-black/20 border border-borderDark"><span class="${efColor}">EF ${ef}</span></span><span class="px-1.5 py-0.5 rounded bg-black/20 border border-borderDark">Rep ${rep}</span>`;
    const f = document.getElementById('fc-front-meta'); if(f) f.innerHTML = html;
    const b = document.getElementById('fc-back-meta'); if(b) b.innerHTML = html;
}

function flipCard() { 
    if(!currentCard || isCardFlipped) return;
    if (currentCard.type === 'mcq') return; // MCQ handled inline
    isCardFlipped = true; 

    // Render Markdown & Math for Back
    const backEl = document.getElementById('fc-back-content');
    backEl.innerHTML = renderMarkdownWithMath(currentCard.a);
    renderMathInElement(backEl, { delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}], throwOnError: false });

    document.getElementById('fc-inner').style.transform = 'rotateY(180deg)';
    document.getElementById('srs-controls').classList.remove('hidden'); document.getElementById('srs-controls').classList.add('flex');
}

function gradeCard(quality) {
    if(quality >= 3) {
        if(currentCard.rep === 0) currentCard.int = 1; else if(currentCard.rep === 1) currentCard.int = 6; else currentCard.int = Math.round(currentCard.int * currentCard.ef);
        currentCard.rep++;
    } else { currentCard.rep = 0; currentCard.int = 1; }

    currentCard.ef = currentCard.ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (currentCard.ef < 1.3) currentCard.ef = 1.3;

    let nextOffset = quality < 3 ? (1000 * 60 * 10) : (currentCard.int * 86400000); 
    currentCard.next = Date.now() + nextOffset;

    // ── LEECH DETECTION (>5 wrongs in last 7 days) ─────────────
    if (quality < 3) {
        currentCard.wrongLog = currentCard.wrongLog || [];
        currentCard.wrongLog.push(Date.now());
        const weekAgo = Date.now() - 7 * 86400000;
        currentCard.wrongLog = currentCard.wrongLog.filter(t => t >= weekAgo);
        if (currentCard.wrongLog.length > 5 && !currentCard.leech) {
            flagLeech(currentCard);
        }
    }
    saveDataToDB(); updateFlashcardUI();
}

function flagLeech(card){
    card.leech = true;
    toast('🪤 Leech detected: "' + (card.q || '').slice(0, 40) + '" — sent to AI Tutor for a breakdown.', 'error');
    // Auto-prompt AI Tutor to break it down with a simpler analogy.
    try {
        state.tutorChat = state.tutorChat || [];
        const prompt = `This flashcard has been answered incorrectly more than 5 times this past week (a "leech"). Please (1) break the concept into 2–3 simpler sub-concepts, and (2) give a vivid analogy that makes it stick.\n\nFRONT: ${card.q}\n\nBACK: ${card.a}`;
        state.tutorChat.push({ role: 'user', content: prompt });
        saveDataToDB();
    } catch(e) { /* tutor not initialised yet */ }
}

