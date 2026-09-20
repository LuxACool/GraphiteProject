        // ===== STUBS for removed features (prevent ReferenceErrors) =====
        function rotateJournalPrompt(){}
        function renderJournal(){}
        function saveJournal(){}
        function drawMoodChart(){}
        function addHabit(){}
        function toggleHabit(){}
        function deleteHabit(){}
        function renderHabits(){}
        function addReading(){}
        function filterReading(){}
        function toggleReading(){}
        function deleteReading(){}
        function renderReading(){}
        function populateQuizNoteSelect(){}
        function generateQuiz(){}
        function saveQuizCard(){}
        function plotFunction(){}
        function computeKSSData(){return {score:0,total:0,linked:0,orphans:0,links:0};}
        function runKSSAnalysis(){}
        function renderKSSSparkline(){}
        function updateKSSMiniCard(){}
        function toggleFocusAware(){}
        function showFocusSuggestionsPanel(){}
        function hideFocusSuggestionsPanel(){}
        function extractKeywords(){return [];}
        function scoreNoteRelevance(){return 0;}
        function refreshFocusSuggestions(){}
        function insertSuggestion(){}
        function _doFTS(){}
        function runFullTextSearch(){
          const q = (document.getElementById('hdr-search-input')?.value || '').toLowerCase().trim();
          const resultsEl = document.getElementById('hdr-search-results');
          if(!resultsEl) return;
          if(!q){ resultsEl.innerHTML = '<div class="text-textMuted text-sm p-4">Start typing to search your notes...</div>'; return; }
          const hits = (state.notes||[]).filter(n => n.workspaceId===state.activeWorkspace && (
            (n.title||'').toLowerCase().includes(q) ||
            (n.body||'').toLowerCase().includes(q) ||
            (n.tags||'').toLowerCase().includes(q)
          )).slice(0,30);
          if(!hits.length){ resultsEl.innerHTML = '<div class="text-textMuted text-sm p-4">No results.</div>'; return; }
          resultsEl.innerHTML = hits.map(n=>{
            const body = (n.body||'').slice(0,160).replace(/</g,'&lt;');
            return `<div class="px-4 py-3 border-b border-borderDark hover:bg-accent/10 cursor-pointer" onclick="closeHeaderSearch(); switchApp('notes'); loadNoteIntoEditor('${n.id}')">
              <div class="text-sm font-semibold text-textMain">${(n.title||'Untitled').replace(/</g,'&lt;')}</div>
              <div class="text-xs text-textMuted mt-1 line-clamp-2">${body}</div>
            </div>`;
          }).join('');
        }
        function openHeaderSearch(){
          const overlay = document.getElementById('hdr-search-overlay');
          if(!overlay) return;
          overlay.classList.remove('hidden');
          setTimeout(()=>{ document.getElementById('hdr-search-input')?.focus(); }, 50);
          runFullTextSearch();
        }
        function closeHeaderSearch(){
          document.getElementById('hdr-search-overlay')?.classList.add('hidden');
        }

document.addEventListener('keydown', e => { if((e.ctrlKey||e.metaKey) && e.key==='/') { e.preventDefault(); openHeaderSearch(); } });

// Scrollable toolbar fade hint
document.addEventListener('DOMContentLoaded', () => {
    const scroll = document.querySelector('.md-toolbar-scroll');
    const wrap = document.querySelector('.md-toolbar-wrap');
    if (scroll && wrap) {
        scroll.addEventListener('scroll', () => {
            const atEnd = scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 4;
            wrap.classList.toggle('scrolled-end', atEnd);
        }, { passive: true });
    }
});

// Flashcard keyboard navigation (Arrow keys + Space when on flashcards tab)
document.addEventListener('keydown', (e) => {
    if (typeof currentApp === 'undefined' || currentApp !== 'flashcards') return;
    const modal = document.getElementById('custom-modal');
    if (modal && !modal.classList.contains('hidden')) return; // don't intercept when modal open
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); fcNextCard(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); fcPrevCard(); }
    else if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); flipCard(); }
});
