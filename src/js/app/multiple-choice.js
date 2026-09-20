        /* ============================================================
           MULTIPLE CHOICE ENGINE
           ============================================================ */
        let mcQuestions = [];
        let mcIndex = 0;
        let mcCorrect = 0;
        let mcAnswered = false;

        function setQuestionType(type) {
            document.querySelectorAll('.qtype-btn').forEach(b => b.classList.remove('qtype-active'));
            document.getElementById('qtype-' + type).classList.add('qtype-active');
            if (type === 'mc') {
                document.getElementById('flashcard-mode-wrap').classList.add('hidden');
                document.getElementById('mc-mode-wrap').classList.remove('hidden');
            } else {
                document.getElementById('mc-mode-wrap').classList.add('hidden');
                document.getElementById('flashcard-mode-wrap').classList.remove('hidden');
            }
        }

        async function startMCSession() {
            const source = document.getElementById('mc-source').value;
            const count  = parseInt(document.getElementById('mc-count').value) || 10;
            const btn    = document.getElementById('mc-gen-btn');
            const icon   = document.getElementById('mc-gen-icon');

            // Hide states
            document.getElementById('mc-empty').classList.add('hidden');
            document.getElementById('mc-results').classList.add('hidden');
            document.getElementById('mc-question-card').classList.add('hidden');
            document.getElementById('mc-score-bar').classList.add('hidden');

            btn.disabled = true;
            icon.innerHTML = '<span class="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>';

            // Build source content
            let content = '';
            const wsNotes = state.notes.filter(n => n.workspaceId === state.activeWorkspace);
            const wsCards = state.flashcards.filter(c => c.workspaceId === state.activeWorkspace);

            if (source === 'notes' || source === 'both') {
                content += wsNotes.slice(0, 12).map(n => `## ${n.title}\n${(n.body||'').slice(0,600)}`).join('\n\n');
            }
            if (source === 'cards' || source === 'both') {
                content += '\n\n' + wsCards.slice(0, 30).map(c => `Q: ${c.q}\nA: ${c.a}`).join('\n');
            }

            if (!content.trim()) {
                toast('No notes or cards found. Add some content first.', 'error');
                btn.disabled = false; icon.textContent = ''; return;
            }

            const sys = `You are an exam question generator. Based on the study material provided, generate exactly ${count} multiple choice questions.

Return ONLY a JSON array with this exact structure:
[
  {
    "question": "Question text here?",
    "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
    "correct": 0,
    "explanation": "Brief explanation of why the answer is correct."
  }
]

Rules:
- "correct" is the 0-based index of the correct option in the "options" array
- All 4 options must be plausible (good distractors)
- Questions must be directly based on the provided material
- Return ONLY the JSON array, no markdown, no preamble`;

            try {
                const raw = await callPollinationsAI(`STUDY MATERIAL:\n${content.slice(0, 4000)}`, sys);
                const cleaned = raw.replace(/`{3}json|`{3}/g, '').trim();
                const match = cleaned.match(/\[[\s\S]*\]/);
                if (!match) throw new Error('No JSON array found in response');
                mcQuestions = JSON.parse(match[0]);
                if (!Array.isArray(mcQuestions) || mcQuestions.length === 0) throw new Error('Empty question set');

                mcIndex = 0; mcCorrect = 0;
                document.getElementById('mc-q-total').textContent = mcQuestions.length;
                document.getElementById('mc-score-total').textContent = mcQuestions.length;
                document.getElementById('mc-score-bar').classList.remove('hidden');
                renderMCQuestion();
            } catch(err) {
                toast('Failed to generate questions: ' + err.message, 'error');
                document.getElementById('mc-empty').classList.remove('hidden');
            } finally {
                btn.disabled = false; icon.textContent = '';
            }
        }

        function renderMCQuestion() {
            const q = mcQuestions[mcIndex];
            if (!q) { showMCResults(); return; }

            mcAnswered = false;
            document.getElementById('mc-q-num').textContent = mcIndex + 1;
            document.getElementById('mc-score').textContent = mcCorrect;
            document.getElementById('mc-question-text').textContent = q.question;
            document.getElementById('mc-explanation').classList.add('hidden');
            document.getElementById('mc-explanation').textContent = '';
            document.getElementById('mc-next-btn').classList.add('hidden');

            const letters = ['A', 'B', 'C', 'D'];
            const optEl = document.getElementById('mc-options');
            optEl.innerHTML = q.options.map((opt, i) => `
                <button class="mc-option" onclick="answerMC(${i})" id="mc-opt-${i}">
                    <span class="mc-letter">${letters[i]}</span>
                    <span>${opt}</span>
                </button>
            `).join('');

            document.getElementById('mc-question-card').classList.remove('hidden');
        }

        function answerMC(chosen) {
            if (mcAnswered) return;
            mcAnswered = true;
            const q = mcQuestions[mcIndex];
            const correct = q.correct;
            const isRight = chosen === correct;
            if (isRight) mcCorrect++;
            document.getElementById('mc-score').textContent = mcCorrect;

            // Style options
            document.querySelectorAll('.mc-option').forEach((el, i) => {
                el.classList.add('mc-locked');
                el.onclick = null;
                if (i === correct && i === chosen) el.classList.add('mc-correct');
                else if (i === chosen && !isRight) el.classList.add('mc-wrong');
                else if (i === correct) el.classList.add('mc-reveal-correct');
            });

            // Show explanation
            if (q.explanation) {
                const expEl = document.getElementById('mc-explanation');
                expEl.textContent = (isRight ? ' Correct! ' : ' Incorrect. ') + q.explanation;
                expEl.style.borderLeft = `3px solid ${isRight ? '#10b981' : '#f43f5e'}`;
                expEl.classList.remove('hidden');
            }

            document.getElementById('mc-next-btn').classList.remove('hidden');
        }

        function mcNextQuestion() {
            mcIndex++;
            if (mcIndex >= mcQuestions.length) { showMCResults(); return; }
            renderMCQuestion();
        }

        function showMCResults() {
            document.getElementById('mc-question-card').classList.add('hidden');
            document.getElementById('mc-score-bar').classList.add('hidden');
            const total = mcQuestions.length;
            const pct = Math.round((mcCorrect / total) * 100);
            const emoji = pct >= 90 ? '' : pct >= 70 ? '' : pct >= 50 ? '' : '';
            const label = pct >= 90 ? 'Outstanding!' : pct >= 70 ? 'Great work!' : pct >= 50 ? 'Keep studying!' : 'More practice needed.';
            document.getElementById('mc-result-emoji').textContent = emoji;
            document.getElementById('mc-result-score').textContent = `${mcCorrect} / ${total} correct (${pct}%)`;
            document.getElementById('mc-result-label').textContent = label;

            // Breakdown
            const letters = ['A','B','C','D'];
            document.getElementById('mc-result-breakdown').innerHTML = mcQuestions.map((q, i) => {
                const userAnswered = '?'; // we don't store per-question answer, just summary
                return `<div class="text-xs py-2 border-b border-borderDark/50 text-textMuted"><span class="font-semibold text-textMain">${i+1}. ${q.question.slice(0,80)}${q.question.length>80?'…':''}</span><br/>Correct: <span class="text-mint">${letters[q.correct]}. ${q.options[q.correct]}</span></div>`;
            }).join('');

            document.getElementById('mc-results').classList.remove('hidden');
        }

        /* ═══════════════════════════════════════════════════════
           CUSTOM FORM COMPONENT ENGINE
           ═══════════════════════════════════════════════════════ */
        function cselToggle(id, e) {
            if (e) e.stopPropagation();
            const btn = document.getElementById(id + '-btn');
            const dd  = document.getElementById(id + '-dd');
            if (!btn || !dd) return;
            const isOpen = dd.classList.contains('open');
            document.querySelectorAll('.csel-dropdown.open').forEach(el => {
                el.classList.remove('open');
                document.getElementById(el.id.replace('-dd','-btn'))?.classList.remove('open');
            });
            btn.classList.toggle('open', !isOpen);
            dd.classList.toggle('open', !isOpen);
            btn.setAttribute('aria-expanded', String(!isOpen));
        }
        function cselChoose(id, value, label) {
            const btn = document.getElementById(id + '-btn');
            const dd  = document.getElementById(id + '-dd');
            const hidden = document.getElementById(id);
            if (!btn || !dd) return;
            const span = btn.querySelector('.csel-label');
            if (span) span.textContent = label;
            if (hidden) { hidden.value = value; hidden.dispatchEvent(new Event('change',{bubbles:true})); }
            dd.querySelectorAll('.csel-option').forEach(o => o.classList.toggle('selected', o.dataset.val === String(value)));
            btn.classList.remove('open'); dd.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
        }

        // Convert any visible native <select> into the app's menu component.
        // This also covers controls added later by modals, notifications, and
        // whiteboard tools, so no browser dropdown can slip into a new screen.
        let generatedSelectId = 0;
        function initCustomSelects(root = document) {
            root.querySelectorAll('select:not(.hidden):not([data-custom-select])').forEach(select => {
                if (!select.options.length) return;
                if (!select.id) select.id = `custom-select-${++generatedSelectId}`;

                const id = select.id;
                const wrapper = document.createElement('div');
                wrapper.className = 'csel';
                if (select.classList.contains('w-full')) wrapper.classList.add('w-full');
                if (select.style.width) wrapper.style.width = select.style.width;
                wrapper.dataset.customSelectFor = id;

                const button = document.createElement('button');
                button.type = 'button';
                button.id = id + '-btn';
                button.className = 'csel-btn lg';
                button.setAttribute('aria-haspopup', 'listbox');
                button.setAttribute('aria-expanded', 'false');
                button.innerHTML = '<span class="csel-label"></span><svg class="csel-arrow" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 4l4 4 4-4"/></svg>';

                const dropdown = document.createElement('div');
                dropdown.id = id + '-dd';
                dropdown.className = 'csel-dropdown';
                dropdown.setAttribute('role', 'listbox');

                Array.from(select.options).forEach(option => {
                    const item = document.createElement('div');
                    item.className = 'csel-option';
                    item.dataset.val = option.value;
                    item.textContent = option.text;
                    item.setAttribute('role', 'option');
                    item.addEventListener('click', () => cselChoose(id, option.value, option.text));
                    dropdown.appendChild(item);
                });

                const sync = () => {
                    const selected = select.options[select.selectedIndex];
                    if (!selected) return;
                    button.querySelector('.csel-label').textContent = selected.text;
                    dropdown.querySelectorAll('.csel-option').forEach(item => {
                        const active = item.dataset.val === String(select.value);
                        item.classList.toggle('selected', active);
                        item.setAttribute('aria-selected', String(active));
                    });
                };

                select.dataset.customSelect = 'true';
                select.classList.add('hidden');
                select.parentNode.insertBefore(wrapper, select);
                wrapper.append(select, button, dropdown);
                button.addEventListener('click', event => cselToggle(id, event));
                button.addEventListener('keydown', event => {
                    const options = Array.from(select.options);
                    let index = select.selectedIndex;
                    if (event.key === 'ArrowDown') index = Math.min(index + 1, options.length - 1);
                    else if (event.key === 'ArrowUp') index = Math.max(index - 1, 0);
                    else if (event.key === 'Home') index = 0;
                    else if (event.key === 'End') index = options.length - 1;
                    else if (event.key === 'Escape') { dropdown.classList.remove('open'); button.classList.remove('open'); return; }
                    else return;
                    event.preventDefault();
                    cselChoose(id, options[index].value, options[index].text);
                });
                select.addEventListener('change', sync);
                sync();
            });
        }
        function syncCustomSelects(root = document) {
            root.querySelectorAll('select[data-custom-select]').forEach(select => select.dispatchEvent(new Event('change')));
        }
        document.addEventListener('click', () => {
            document.querySelectorAll('.csel-dropdown.open').forEach(el => {
                el.classList.remove('open');
                const button = document.getElementById(el.id.replace('-dd','-btn'));
                button?.classList.remove('open');
                button?.setAttribute('aria-expanded', 'false');
            });
        });
        document.addEventListener('DOMContentLoaded', () => {
            initCustomSelects();
            new MutationObserver(records => {
                records.forEach(record => record.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) initCustomSelects(node);
                }));
            }).observe(document.body, { childList: true, subtree: true });
        });
        function crangeUpdate(el) {
            const min = parseFloat(el.min||0), max = parseFloat(el.max||1), val = parseFloat(el.value);
            el.style.setProperty('--val', ((val-min)/(max-min)*100).toFixed(1)+'%');
        }
        function initCustomRanges() {
            document.querySelectorAll('input.crange').forEach(el => {
                crangeUpdate(el);
                el.addEventListener('input', () => crangeUpdate(el));
            });
        }
        document.addEventListener('DOMContentLoaded', initCustomRanges);
        setTimeout(initCustomRanges, 200);

        /* ═══════════════════════════════════════════════════════
           KANBAN TASK NOTIFICATION SYSTEM
           ═══════════════════════════════════════════════════════ */
        const NOTIF_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
        let taskNotifInterval = null;

        function initTaskNotifications() {
            // Permission is requested explicitly from Settings. This avoids
            // an unsolicited OS/browser permission prompt during startup.
            scheduleTaskNotifications();
        }

        function scheduleTaskNotifications() {
            clearInterval(taskNotifInterval);
            // Fire once after a short delay so first check happens on startup (if there are tasks)
            setTimeout(checkAndNotifyKanbanTasks, 5000);
            // Then repeat every interval
            taskNotifInterval = setInterval(checkAndNotifyKanbanTasks, NOTIF_INTERVAL_MS);
        }

        function checkAndNotifyKanbanTasks() {
            if (typeof state === 'undefined' || !state.kanban || !window.NotifSystem) return;

            const wsId = state.activeWorkspace;
            const todo = (state.kanban.todo || []).filter(t => t.workspaceId === wsId);
            const progress = (state.kanban.progress || []).filter(t => t.workspaceId === wsId);
            const pending = [...todo, ...progress];
            if (!pending.length) return;

            const task = pending[Math.floor(Math.random() * pending.length)];
            const col = todo.includes(task) ? 'To Do' : 'In Progress';
            const body = pending.length === 1
                ? `"${task.title}" is still waiting on your board.`
                : `You have ${pending.length} open tasks. Next up: "${task.title}" (${col})`;

            window.NotifSystem.notify('taskDeadline', 'Graphite — Task Reminder', body, {
                dedupeKey: 'kanban-task-reminder-' + todayKey(),
                ignoreQuietHours: false,
                onClick: () => switchApp && switchApp('kanban')
            });
        }

        // Kick off on DOMContentLoaded
        document.addEventListener('DOMContentLoaded', initTaskNotifications);

        /* ═══════════════════════════════════════════════════════════════
           KANBAN TOUCH DRAG-AND-DROP ENGINE
           Replaces the non-functional HTML5 drag API on touch screens.
           Works in parallel with the existing mouse drag (desktop unchanged).

           Flow:
             touchstart  → identify card, create ghost clone, dim source
             touchmove   → move ghost under finger, find target column,
                           show drop indicator at exact insert position
             touchend    → move task in state, clean up all visual artefacts
        ════════════════════════════════════════════════════════════════ */
        (function initKanbanTouch() {

            /* ── State ── */
            let ghost        = null;   // floating clone element
            let sourceEl     = null;   // original card DOM node
            let sourceCol    = null;   // 'todo' | 'progress' | 'done'
            let taskId       = null;   // task id string
            let indicator    = null;   // drop position line element
            let activeColEl  = null;   // currently hovered column wrapper
            let insertBefore = null;   // card node to insert before (null = append)
            let startX       = 0;
            let startY       = 0;
            let ghostW       = 0;
            let ghostH       = 0;
            const THRESHOLD  = 6;      // px of movement before drag activates
            let didDrag      = false;

            /* ── Column map (id → col key) ── */
            const COL_MAP = { 'kb-todo': 'todo', 'kb-progress': 'progress', 'kb-done': 'done' };

            /* ── Helpers ── */
            function getCard(el) {
                return el.closest('[data-task-id]');
            }

            function getColContainer(el) {
                // Returns the inner card-list div (kb-todo / kb-progress / kb-done)
                return el.closest('#kb-todo, #kb-progress, #kb-done');
            }

            function getColWrapper(el) {
                // Returns the outer .kb-col panel
                return el.closest('.kb-col');
            }

            function createGhost(card, touchX, touchY) {
                const rect = card.getBoundingClientRect();
                ghostW = Math.min(rect.width, Math.max(280, window.innerWidth - 24));
                ghostH = Math.min(rect.height, Math.max(120, window.innerHeight * 0.45));
                ghost = card.cloneNode(true);
                ghost.classList.add('kb-drag-ghost');
                ghost.style.width  = ghostW + 'px';
                ghost.style.height = ghostH + 'px';
                ghost.style.maxWidth = 'calc(100vw - 24px)';
                ghost.style.maxHeight = '45vh';
                ghost.style.boxSizing = 'border-box';
                ghost.style.transform = 'none';
                ghost.style.left   = (touchX - ghostW / 2) + 'px';
                ghost.style.top    = (touchY - ghostH / 2) + 'px';
                document.body.appendChild(ghost);
            }

            function moveGhost(touchX, touchY) {
                if (!ghost) return;
                ghost.style.left = (touchX - ghostW / 2) + 'px';
                ghost.style.top  = (touchY - ghostH / 2) + 'px';
            }

            function removeGhost() {
                if (ghost) { ghost.remove(); ghost = null; }
            }

            function removeIndicator() {
                if (indicator) { indicator.remove(); indicator = null; }
                insertBefore = null;
            }

            function clearColHighlight() {
                if (activeColEl) {
                    activeColEl.classList.remove('kb-col-touch-over');
                    activeColEl = null;
                }
            }

            function cleanup() {
                removeGhost();
                removeIndicator();
                clearColHighlight();
                if (sourceEl) {
                    sourceEl.classList.remove('kb-dragging-source');
                    sourceEl = null;
                }
                sourceCol = null; taskId = null; didDrag = false; insertBefore = null;
            }

            /* Find which card in a list the finger is hovering above,
               and place the indicator line above that card (or at the bottom). */
            function updateDropIndicator(listEl, touchY) {
                removeIndicator();
                const cards = [...listEl.querySelectorAll('[data-task-id]')]
                    .filter(c => c !== sourceEl);

                insertBefore = null;
                let placed = false;

                for (const card of cards) {
                    const r = card.getBoundingClientRect();
                    const mid = r.top + r.height / 2;
                    if (touchY < mid) {
                        insertBefore = card;
                        indicator = document.createElement('div');
                        indicator.className = 'kb-drop-indicator';
                        listEl.insertBefore(indicator, card);
                        placed = true;
                        break;
                    }
                }

                if (!placed) {
                    // Append indicator at the bottom
                    indicator = document.createElement('div');
                    indicator.className = 'kb-drop-indicator';
                    listEl.appendChild(indicator);
                }
            }

            /* ── touchstart ── */
            document.addEventListener('touchstart', function(e) {
                const card = getCard(e.target);
                if (!card) return;

                // Only activate on mobile widths
                if (window.innerWidth > 767) return;

                const touch = e.touches[0];
                startX   = touch.clientX;
                startY   = touch.clientY;
                sourceEl = card;
                taskId   = card.dataset.taskId;
                sourceCol = card.dataset.taskCol;
                didDrag  = false;
            }, { passive: true });

            /* ── touchmove ── */
            document.addEventListener('touchmove', function(e) {
                if (!sourceEl) return;

                const touch = e.touches[0];
                const dx = touch.clientX - startX;
                const dy = touch.clientY - startY;

                // Activate drag once finger moves past threshold
                if (!didDrag) {
                    if (Math.sqrt(dx*dx + dy*dy) < THRESHOLD) return;
                    didDrag = true;
                    sourceEl.classList.add('kb-dragging-source');
                    createGhost(sourceEl, touch.clientX, touch.clientY);
                }

                e.preventDefault(); // block page scroll while dragging a card
                moveGhost(touch.clientX, touch.clientY);

                // Hit-test: find the column under the finger
                ghost.style.display = 'none'; // hide ghost so elementFromPoint works
                const elUnder = document.elementFromPoint(touch.clientX, touch.clientY);
                ghost.style.display = '';

                const listEl = elUnder ? getColContainer(elUnder) : null;
                const wrapEl = elUnder ? getColWrapper(elUnder) : null;

                if (listEl && COL_MAP[listEl.id] !== undefined) {
                    // Highlight column wrapper
                    if (wrapEl && wrapEl !== activeColEl) {
                        clearColHighlight();
                        activeColEl = wrapEl;
                        activeColEl.classList.add('kb-col-touch-over');
                    }
                    updateDropIndicator(listEl, touch.clientY);
                } else {
                    clearColHighlight();
                    removeIndicator();
                }

            }, { passive: false });

            /* ── touchend ── */
            document.addEventListener('touchend', function(e) {
                if (!sourceEl || !didDrag) { cleanup(); return; }

                const touch = e.changedTouches[0];

                // Find drop target column
                ghost.style.display = 'none';
                const elUnder = document.elementFromPoint(touch.clientX, touch.clientY);
                ghost.style.display = '';

                const listEl = elUnder ? getColContainer(elUnder) : null;
                const targetCol = listEl ? COL_MAP[listEl.id] : null;

                if (targetCol && taskId) {
                    const isSameCol = targetCol === sourceCol;
                    const taskIndex = state.kanban[sourceCol].findIndex(t => t.id === taskId);
                    if (taskIndex !== -1) {
                        // Remove from source
                        const [task] = state.kanban[sourceCol].splice(taskIndex, 1);

                        if (isSameCol && insertBefore) {
                            // Reorder within same column
                            const targetIndex = state.kanban[targetCol].findIndex(
                                t => t.id === insertBefore.dataset.taskId
                            );
                            if (targetIndex !== -1) {
                                state.kanban[targetCol].splice(targetIndex, 0, task);
                            } else {
                                state.kanban[targetCol].push(task);
                            }
                        } else {
                            // Move to different column — insert at position or append
                            if (insertBefore && insertBefore.dataset.taskId) {
                                const targetIndex = state.kanban[targetCol].findIndex(
                                    t => t.id === insertBefore.dataset.taskId
                                );
                                if (targetIndex !== -1) {
                                    state.kanban[targetCol].splice(targetIndex, 0, task);
                                } else {
                                    state.kanban[targetCol].push(task);
                                }
                            } else {
                                state.kanban[targetCol].push(task);
                            }
                        }

                        if (targetCol === 'done' && sourceCol !== 'done') {
                            trackActivity('tasks');
                        }
                        saveDataToDB();
                        renderKanban();
                    }
                }

                cleanup();
            }, { passive: true });

            /* ── touchcancel ── */
            document.addEventListener('touchcancel', cleanup, { passive: true });

        })(); /* end initKanbanTouch */

        /* ═══════════════════════════════════════════════════════════════
           SWIPE-UP NAV SHEET ENGINE
        ════════════════════════════════════════════════════════════════ */
        (function initMobNavSheet() {

            const sheet   = () => document.getElementById('mob-nav-sheet');
            const scrim   = () => document.getElementById('mob-nav-scrim');
            const handle  = () => document.getElementById('mob-nav-sheet-handle');

            /* ── Open / Close ── */
            window.mobNavSheetOpen = function() {
                if (window.innerWidth > 767) return;
                const s = scrim(); const sh = sheet();
                s.style.display = 'block';
                // Force reflow before adding class so transition fires
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        s.classList.add('visible');
                        sh.classList.add('open');
                    });
                });
                // Sync workspace label
                const wsName = document.getElementById('ws-name-display');
                const wsLabel = document.getElementById('mob-nav-ws-label');
                const wsDot = document.getElementById('mob-nav-ws-dot');
                const wsIndicator = document.getElementById('ws-color-indicator');
                if (wsName && wsLabel) wsLabel.textContent = wsName.textContent;
                if (wsIndicator && wsDot) wsDot.style.background = wsIndicator.style.background || 'rgb(var(--accent))';
                // Sync active item
                mobNavSyncActive(typeof currentApp !== 'undefined' ? currentApp : 'dashboard');
                document.body.style.overflow = 'hidden';
            };

            window.mobNavSheetClose = function() {
                const s = scrim(); const sh = sheet();
                s.classList.remove('visible');
                sh.classList.remove('open');
                s.addEventListener('transitionend', () => { s.style.display = 'none'; }, { once: true });
                document.body.style.overflow = '';
            };

            /* ── Navigate from sheet ── */
            window.mobNavNavigate = function(appId) {
                mobNavSheetClose();
                switchApp(appId);
            };

            /* ── Sync active item highlight ── */
            function mobNavSyncActive(appId) {
                document.querySelectorAll('.mob-nav-item').forEach(el => {
                    el.classList.toggle('mob-nav-active', el.dataset.app === appId);
                });
            }

            /* ── Swipe-down-to-close on the handle & sheet ── */
            let touchStartY = 0, touchCurY = 0, isDragging = false;
            const CLOSE_THRESHOLD = 80; // px swipe down to dismiss

            function onTouchStart(e) {
                touchStartY = e.touches[0].clientY;
                touchCurY = touchStartY;
                isDragging = true;
            }

            function onTouchMove(e) {
                if (!isDragging) return;
                touchCurY = e.touches[0].clientY;
                const dy = touchCurY - touchStartY;
                if (dy > 0) {
                    e.preventDefault();
                    sheet().style.transform = `translateY(${dy}px)`;
                }
            }

            function onTouchEnd() {
                if (!isDragging) return;
                isDragging = false;
                const dy = touchCurY - touchStartY;
                sheet().style.transform = ''; // reset inline override
                if (dy > CLOSE_THRESHOLD) {
                    mobNavSheetClose();
                } else {
                    // Snap back with a bounce
                    sheet().style.transition = 'transform 0.2s cubic-bezier(0.34,1.56,0.64,1)';
                    setTimeout(() => { sheet().style.transition = ''; }, 220);
                }
            }

            document.addEventListener('DOMContentLoaded', function() {
                const sh = sheet();
                const h  = handle();
                if (!sh || !h) return;

                // Drag on handle
                h.addEventListener('touchstart',  onTouchStart, { passive: true });
                h.addEventListener('touchmove',   onTouchMove,  { passive: false });
                h.addEventListener('touchend',    onTouchEnd,   { passive: true });

                // Drag on the sheet header area too
                sh.addEventListener('touchstart',  onTouchStart, { passive: true });
                sh.addEventListener('touchmove',   onTouchMove,  { passive: false });
                sh.addEventListener('touchend',    onTouchEnd,   { passive: true });

                // Sync active when switchApp is called
                const _orig = window.switchApp;
                if (_orig) {
                    window.switchApp = function(appId) {
                        _orig.call(this, appId);
                        mobNavSyncActive(appId);
                    };
                }
            });

        })();

        /* ══ NOTES OVERFLOW POPOVER ════════════════════════════════════ */
        function noteOverflowToggle() {
            const menu = document.getElementById('note-overflow-menu');
            const btn  = document.getElementById('note-overflow-btn');
            const isOpen = !menu.classList.contains('hidden');
            if (isOpen) {
                noteOverflowClose();
            } else {
                menu.classList.remove('hidden');
                btn.setAttribute('aria-expanded', 'true');
                // Close when tapping outside
                setTimeout(() => {
                    document.addEventListener('click', noteOverflowOutside, { once: true });
                    document.addEventListener('touchstart', noteOverflowOutside, { once: true });
                }, 0);
            }
        }
        function noteOverflowClose() {
            const menu = document.getElementById('note-overflow-menu');
            const btn  = document.getElementById('note-overflow-btn');
            if (menu) menu.classList.add('hidden');
            if (btn)  btn.setAttribute('aria-expanded', 'false');
        }
        function noteOverflowOutside(e) {
            const wrap = document.getElementById('note-overflow-wrap');
            if (wrap && !wrap.contains(e.target)) noteOverflowClose();
        }
        /* ══ END NOTES OVERFLOW POPOVER ════════════════════════════════ */

        /* ══ MOBILE BOTTOM NAV — Active State Controller ══ */
        function mbnSetActive(clickedBtn) {
            document.querySelectorAll('.mobile-bottom-nav__item')
                .forEach(btn => btn.classList.remove('active'));
            // Only add active class to non-home buttons (home has its own persistent pill style)
            if (clickedBtn && !clickedBtn.classList.contains('mobile-bottom-nav__home')) {
                clickedBtn.classList.add('active');
            }
        }
        function mbnSyncToApp(appId) {
            const target = document.querySelector(`.mobile-bottom-nav__item[data-app="${appId}"]`);
            document.querySelectorAll('.mobile-bottom-nav__item')
                .forEach(btn => btn.classList.remove('active'));
            // Only highlight non-home targets
            if (target && !target.classList.contains('mobile-bottom-nav__home')) {
                target.classList.add('active');
            }
        }
        (function patchSwitchApp() {
            const _original = switchApp;
            switchApp = function(appId) {
                _original.call(this, appId);
                mbnSyncToApp(appId);
            };
        })();
        document.addEventListener('DOMContentLoaded', function() {
            mbnSyncToApp(typeof currentApp !== 'undefined' ? currentApp : 'dashboard');
        });
