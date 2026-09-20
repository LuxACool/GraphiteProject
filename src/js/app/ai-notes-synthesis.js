        /* ============================================================
           AI NOTE ACTIONS & SYNTHESIS ENGINE
           ============================================================ */

        // ── Close AI note menu on outside click ──────────────────────
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('ai-note-menu');
            const wrap = document.getElementById('ai-note-actions-wrap');
            if (menu && wrap && !wrap.contains(e.target)) menu.classList.add('hidden');
        });

        function toggleAINoteMenu() {
            const menu = document.getElementById('ai-note-menu');
            if (menu) menu.classList.toggle('hidden');
        }

        // ── Shared Pollinations helper ────────────────────────────────
        async function callPollinationsAI(prompt, systemHint = '') {
            const provider = state.settings.aiProvider || 'free';
            const key = state.settings.openaiKey || '';
            const fullPrompt = systemHint ? systemHint + '\n\n' + prompt : prompt;

            if (provider === 'openai' || provider === 'custom') {
                const base = state.settings.openaiBase || 'https://api.openai.com/v1';
                const r = await fetch(base + '/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemHint || 'You are a helpful assistant.' }, { role: 'user', content: prompt }], max_tokens: 1500 })
                });
                const j = await r.json();
                if (j.error) throw new Error(j.error.message);
                return j.choices?.[0]?.message?.content || '';
            } else if (provider === 'claude') {
                const r = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
                    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, system: systemHint || 'You are a helpful assistant.', messages: [{ role: 'user', content: prompt }] })
                });
                const j = await r.json();
                if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
                return j.content?.[0]?.text || '';
            } else if (provider === 'gemini') {
                const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + key, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ system_instruction: { parts: [{ text: systemHint || '' }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }] })
                });
                const j = await r.json();
                if (j.error) throw new Error(j.error.message);
                return j.candidates?.[0]?.content?.parts?.[0]?.text || '';
            } else {
                // Pollinations free endpoint
                const combined = encodeURIComponent(fullPrompt.slice(0, 3000));
                const r = await fetch('https://text.pollinations.ai/' + combined);
                return await r.text();
            }
        }

        // ── Show/hide AI loading overlay ─────────────────────────────
        function showAILoading(title = 'AI is thinking…', sub = 'This may take a moment') {
            const el = document.getElementById('ai-note-loading');
            if (el) {
                document.getElementById('ai-loading-title').textContent = title;
                document.getElementById('ai-loading-sub').textContent = sub;
                el.classList.remove('hidden');
            }
        }
        function hideAILoading() {
            document.getElementById('ai-note-loading')?.classList.add('hidden');
        }

        // ── AI: Expand & Improve Note ─────────────────────────────────
        async function aiExpandNote() {
            const note = state.notes.find(n => n.id === state.currentNoteId);
            if (!note) { toast('No note selected.', 'error'); return; }
            showAILoading('Expanding note…', 'AI is enriching your content');
            try {
                const sys = `You are a knowledgeable study assistant. Expand and improve the given note by:
1. Adding more depth, context, and relevant details
2. Fixing any unclear sections  
3. Adding helpful examples or analogies where appropriate
4. Keeping the original structure and markdown formatting
Return ONLY the improved note content — no preamble, no "Here is the improved note:" prefix.`;
                const result = await callPollinationsAI(`CURRENT NOTE TITLE: ${note.title}\n\nCURRENT NOTE CONTENT:\n${note.body}`, sys);
                if (result && result.trim()) {
                    document.getElementById('note-body-raw').value = result.trim();
                    saveNotes(); updateLivePreview(); updateWordCount();
                    toast(' Note expanded by AI!', 'success');
                } else {
                    toast('AI returned empty response. Try again.', 'error');
                }
            } catch (err) {
                toast('AI error: ' + err.message, 'error');
            } finally {
                hideAILoading();
            }
        }

        // ── AI: Summarize Note ────────────────────────────────────────
        async function aiSummarizeNote() {
            const note = state.notes.find(n => n.id === state.currentNoteId);
            if (!note) { toast('No note selected.', 'error'); return; }
            showAILoading('Summarizing…', 'Creating a concise summary');
            try {
                const sys = `You are a study assistant. Create a clear, concise summary of the given note. Format as:
## Summary
[2-3 sentence summary]

## Key Points
- [bullet points of most important information]

## Key Terms
- **Term**: definition

Keep it study-friendly and scannable.`;
                const result = await callPollinationsAI(`TITLE: ${note.title}\n\nCONTENT:\n${note.body}`, sys);
                if (result && result.trim()) {
                    // Append summary to note
                    const ta = document.getElementById('note-body-raw');
                    ta.value = (note.body || '').trim() + '\n\n---\n\n' + result.trim();
                    saveNotes(); updateLivePreview(); updateWordCount();
                    toast(' Summary added to note!', 'success');
                }
            } catch (err) {
                toast('AI error: ' + err.message, 'error');
            } finally {
                hideAILoading();
            }
        }

        // ── AI: Add Context & Examples ────────────────────────────────
        async function aiAddContext() {
            const note = state.notes.find(n => n.id === state.currentNoteId);
            if (!note) { toast('No note selected.', 'error'); return; }
            showAILoading('Adding context…', 'AI is finding examples and analogies');
            try {
                const sys = `You are a tutor. Add relevant context, real-world examples, mnemonics, or analogies to help understand the note's content. 
Format as:
##  AI Context & Examples
[your additions here in markdown]

Keep it practical and memorable. Do NOT repeat the existing content.`;
                const result = await callPollinationsAI(`NOTE TITLE: ${note.title}\n\nNOTE CONTENT:\n${(note.body || '').slice(0, 2000)}`, sys);
                if (result && result.trim()) {
                    const ta = document.getElementById('note-body-raw');
                    ta.value = (note.body || '').trim() + '\n\n' + result.trim();
                    saveNotes(); updateLivePreview(); updateWordCount();
                    toast(' Context & examples added!', 'success');
                }
            } catch (err) {
                toast('AI error: ' + err.message, 'error');
            } finally {
                hideAILoading();
            }
        }

        // ── AI: Find & Connect Related Notes ─────────────────────────
        async function aiConnectNotes() {
            const note = state.notes.find(n => n.id === state.currentNoteId);
            if (!note) { toast('No note selected.', 'error'); return; }
            const wsNotes = state.notes.filter(n => n.workspaceId === state.activeWorkspace && n.id !== state.currentNoteId);
            if (wsNotes.length === 0) { toast('No other notes to connect to.', 'error'); return; }
            showAILoading('Finding connections…', 'Analyzing your knowledge graph');
            try {
                const noteSummaries = wsNotes.slice(0, 20).map(n => `ID:${n.id} TITLE:"${n.title}" SNIPPET:${(n.body || '').slice(0, 150)}`).join('\n');
                const sys = `You are a knowledge graph assistant. Given a focus note and a list of other notes, identify which notes are most semantically related and should be linked.
Return ONLY a JSON array of objects: [{"id":"note_id","title":"note title","reason":"short reason why it connects"}]
Maximum 5 connections. Only include genuinely related notes. Return [] if no good connections exist.`;
                const prompt = `FOCUS NOTE TITLE: "${note.title}"\nFOCUS NOTE CONTENT: ${(note.body || '').slice(0, 800)}\n\nOTHER NOTES:\n${noteSummaries}`;
                const raw = await callPollinationsAI(prompt, sys);
                let connections = [];
                try {
                    const cleaned = raw.replace(/`{3}json|`{3}/g, '').trim();
                    const parsed = JSON.parse(cleaned);
                    connections = Array.isArray(parsed) ? parsed : [];
                } catch (e) {
                    // Try to extract JSON array from text
                    const match = raw.match(/\[[\s\S]*\]/);
                    if (match) { try { connections = JSON.parse(match[0]); } catch {} }
                }

                if (connections.length === 0) {
                    toast('No strong connections found. Add more content to your notes.', 'info');
                    hideAILoading();
                    return;
                }

                // Add wiki links to note body
                const ta = document.getElementById('note-body-raw');
                let body = ta.value;
                let addedLinks = [];
                connections.forEach(conn => {
                    const targetNote = wsNotes.find(n => n.id === conn.id);
                    if (targetNote && !body.includes(`[[${targetNote.title}]]`)) {
                        addedLinks.push(targetNote.title);
                    }
                });

                if (addedLinks.length > 0) {
                    body += '\n\n##  Related Notes\n' + addedLinks.map(t => `- [[${t}]]`).join('\n');
                    ta.value = body;
                    saveNotes(); updateLivePreview();
                    toast(` Linked to ${addedLinks.length} related notes!`, 'success');
                } else {
                    toast('These notes are already linked.', 'info');
                }
            } catch (err) {
                toast('AI error: ' + err.message, 'error');
            } finally {
                hideAILoading();
            }
        }

        // ── AI: Create New Note from Current ──────────────────────────
        async function aiCreateNoteFromIdea() {
            const note = state.notes.find(n => n.id === state.currentNoteId);
            if (!note) { toast('No note selected.', 'error'); return; }
            showAILoading('Creating new note…', 'AI is generating a companion note');
            try {
                const sys = `You are a study assistant. Based on the given note, create a NEW companion note that:
1. Covers a related subtopic or deeper dive into one aspect
2. Uses proper markdown formatting with headers, bullets, and emphasis
3. Starts with a clear title (first line: # Title)
4. Is self-contained and useful as a standalone study note
5. Ends with a connection back: "See also: [[ORIGINAL_TITLE]]"

Return ONLY the new note content in markdown, starting with the # Title.`;
                const result = await callPollinationsAI(`SOURCE NOTE TITLE: ${note.title}\nSOURCE NOTE: ${(note.body || '').slice(0, 1500)}`, sys);
                if (result && result.trim()) {
                    const lines = result.trim().split('\n');
                    const titleLine = lines.find(l => l.startsWith('# '));
                    const newTitle = titleLine ? titleLine.replace('# ', '').trim() : `${note.title} — Deep Dive`;
                    const newBody = lines.filter(l => !l.startsWith('# ')).join('\n').trim();
                    const newNote = {
                        id: 'ai-note-' + Date.now(),
                        title: newTitle,
                        body: newBody,
                        tags: 'ai-generated, ' + (note.tags || ''),
                        timestamp: new Date().toLocaleDateString(),
                        workspaceId: state.activeWorkspace
                    };
                    state.notes.unshift(newNote);
                    // Also add a backlink in the original note
                    const ta = document.getElementById('note-body-raw');
                    if (!ta.value.includes(`[[${newTitle}]]`)) {
                        ta.value = ta.value.trim() + `\n\nSee also: [[${newTitle}]]`;
                        saveNotes();
                    }
                    saveDataToDB(); renderNotesList(); updateLivePreview();
                    toast(` New note "${newTitle}" created!`, 'success');
                }
            } catch (err) {
                toast('AI error: ' + err.message, 'error');
            } finally {
                hideAILoading();
            }
        }

        /* ── AI Synthesis Panel ─────────────────────────────────────── */
        function openAISynthesisPanel() {
            const panel = document.getElementById('ai-synthesis-panel');
            if (!panel) return;
            panel.classList.remove('hidden');
            // Update stats
            const wsNotes = state.notes.filter(n => n.workspaceId === state.activeWorkspace);
            let totalLinks = 0;
            let orphans = 0;
            wsNotes.forEach(n => {
                const matches = (n.body || '').match(/\[\[(.*?)\]\]/g);
                if (matches) totalLinks += matches.length;
                else orphans++;
            });
            const sn = document.getElementById('synth-stat-notes');
            const sl = document.getElementById('synth-stat-links');
            const so = document.getElementById('synth-stat-orphans');
            if (sn) sn.textContent = wsNotes.length;
            if (sl) sl.textContent = totalLinks;
            if (so) so.textContent = orphans;
        }

        function closeAISynthesisPanel() {
            document.getElementById('ai-synthesis-panel')?.classList.add('hidden');
        }

        function updateSynthesisCard() {
            const wsNotes = state.notes.filter(n => n.workspaceId === state.activeWorkspace);
            if (wsNotes.length === 0) {
                const el = document.getElementById('synthesis-detail');
                if (el) el.textContent = 'Add notes to start synthesis';
                return;
            }
            let totalLinks = 0;
            let connectedNotes = 0;
            wsNotes.forEach(n => {
                const matches = (n.body || '').match(/\[\[(.*?)\]\]/g);
                if (matches && matches.length > 0) { totalLinks += matches.length; connectedNotes++; }
            });
            const score = wsNotes.length > 0 ? Math.round((connectedNotes / wsNotes.length) * 100) : 0;
            const ring = document.getElementById('synthesis-ring-fill');
            const pct = document.getElementById('synthesis-pct');
            const label = document.getElementById('synthesis-score-label');
            const detail = document.getElementById('synthesis-detail');
            const bar = document.getElementById('synthesis-bar');
            const offset = 88 - (88 * score / 100);
            if (ring) ring.style.strokeDashoffset = offset;
            if (pct) pct.textContent = score + '%';
            if (label) {
                label.textContent = score >= 70 ? 'Well Connected' : score >= 40 ? 'Growing' : score >= 10 ? 'Starting Out' : 'Isolated';
            }
            if (detail) detail.textContent = `${connectedNotes}/${wsNotes.length} notes linked · ${totalLinks} connections`;
            if (bar) bar.style.width = score + '%';
        }

        async function runAISynthesis() {
            const wsNotes = state.notes.filter(n => n.workspaceId === state.activeWorkspace);
            if (wsNotes.length === 0) { toast('Add some notes first.', 'error'); return; }
            const btn = document.getElementById('synthesis-btn-text');
            const icon = document.getElementById('synthesis-btn-icon');
            const area = document.getElementById('synthesis-result-area');
            if (btn) btn.textContent = 'Analyzing…';
            if (icon) icon.innerHTML = '<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"></div>';
            if (area) area.innerHTML = '<div class="flex items-center gap-3 text-textMuted text-sm py-6 justify-center"><div class="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin"></div> AI is analyzing your knowledge base…</div>';
            try {
                const noteSummaries = wsNotes.slice(0, 30).map(n => {
                    const links = (n.body || '').match(/\[\[(.*?)\]\]/g) || [];
                    return `TITLE: "${n.title}" | TAGS: ${n.tags || 'none'} | LINKS: ${links.join(', ') || 'none'} | CONTENT: ${(n.body || '').slice(0, 300)}`;
                }).join('\n\n');
                const sys = `You are a knowledge graph analyst and learning coach. Analyze these study notes and provide:

1. **KNOWLEDGE SCORE** — Rate the overall knowledge connectivity 0-100
2. **THEMES** — 3-5 main topics/themes you detect
3. **STRONG CONNECTIONS** — 2-3 pairs of notes that are well-connected
4. **KNOWLEDGE GAPS** — 3-4 specific topics or questions that seem missing based on the themes
5. **ORPHAN ALERT** — List note titles that have no connections and suggest what to link them to
6. **NEXT STEPS** — 3 concrete actions to improve the knowledge base

Format your response in clean markdown with these exact section headers. Be specific and reference actual note titles.`;
                const result = await callPollinationsAI(`WORKSPACE NOTES (${wsNotes.length} total):\n\n${noteSummaries}`, sys);
                if (result && result.trim()) {
                    if (area) area.innerHTML = `<div class="prose prose-sm max-w-none">${renderMarkdownWithMath(result.trim())}</div>`;
                } else {
                    if (area) area.innerHTML = '<div class="text-textMuted text-sm text-center py-6">No synthesis generated. Try again.</div>';
                }
            } catch (err) {
                if (area) area.innerHTML = `<div class="text-red-400 text-sm text-center py-6">Error: ${err.message}</div>`;
            } finally {
                if (btn) btn.textContent = 'Run Synthesis';
                if (icon) icon.textContent = '';
            }
        }

        async function aiAutoLinkNotes() {
            const wsNotes = state.notes.filter(n => n.workspaceId === state.activeWorkspace);
            if (wsNotes.length < 2) { toast('Need at least 2 notes to auto-link.', 'error'); return; }
            const area = document.getElementById('synthesis-result-area');
            if (area) area.innerHTML = '<div class="flex items-center gap-3 text-textMuted text-sm py-6 justify-center"><div class="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin"></div> AI is mapping connections…</div>';
            try {
                const noteSummaries = wsNotes.slice(0, 25).map(n => `ID:${n.id} TITLE:"${n.title}" CONTENT:${(n.body || '').slice(0, 200)}`).join('\n');
                const sys = `You are a knowledge graph builder. Find pairs of notes that should be linked.
Return ONLY a JSON array: [{"from_id":"id1","to_title":"Note Title 2","reason":"why they connect"}]
Maximum 8 pairs. Focus on the most meaningful semantic connections. Return [] if no good pairs.`;
                const raw = await callPollinationsAI(wsNotes.slice(0,25).map(n => `"${n.title}": ${(n.body||'').slice(0,200)}`).join('\n---\n'), sys);
                let pairs = [];
                try {
                    const cleaned = raw.replace(/`{3}json|`{3}/g, '').trim();
                    pairs = JSON.parse(cleaned.match(/\[[\s\S]*\]/)?.[0] || '[]');
                } catch (e) { pairs = []; }

                let added = 0;
                pairs.forEach(pair => {
                    const fromNote = wsNotes.find(n => n.id === pair.from_id);
                    if (!fromNote) return;
                    if (!fromNote.body.includes(`[[${pair.to_title}]]`)) {
                        fromNote.body += `\n\n> *Linked: [[${pair.to_title}]]* — ${pair.reason || ''}`;
                        added++;
                    }
                });
                if (added > 0) {
                    saveDataToDB();
                    if (state.currentNoteId) { updateLivePreview(); }
                    if (area) area.innerHTML = `<div class="text-center py-6"><div class="text-3xl mb-3"></div><p class="text-sm text-textMain font-semibold">${added} new connections added to your notes!</p><p class="text-xs text-textMuted mt-2">Run Synthesis again to see the updated knowledge map.</p></div>`;
                    toast(` Added ${added} note connections!`, 'success');
                } else {
                    if (area) area.innerHTML = '<div class="text-center py-6 text-textMuted text-sm">All relevant notes are already connected, or no clear connections found.</div>';
                }
            } catch (err) {
                if (area) area.innerHTML = `<div class="text-red-400 text-sm text-center py-6">Error: ${err.message}</div>`;
            }
        }

        async function aiGenerateSummaryNote() {
            const wsNotes = state.notes.filter(n => n.workspaceId === state.activeWorkspace);
            if (wsNotes.length === 0) { toast('No notes to summarize.', 'error'); return; }
            const area = document.getElementById('synthesis-result-area');
            if (area) area.innerHTML = '<div class="flex items-center gap-3 text-textMuted text-sm py-6 justify-center"><div class="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin"></div> Generating master summary…</div>';
            try {
                const noteContent = wsNotes.slice(0, 15).map(n => `# ${n.title}\n${(n.body || '').slice(0, 400)}`).join('\n\n---\n\n');
                const sys = `You are a study assistant. Create a comprehensive master summary note for a student's entire workspace.
Format as proper markdown:
#  Workspace Summary — [detect the main topic]
## Overview
[2-3 sentences describing what this workspace covers]
## Core Themes
[bullet points]
## Key Notes Index
[list all note titles with one-line description]
## Knowledge Connections
[how the main topics connect]
## Study Recommendations
[what to review next]
Start with the # header. Reference actual note titles using [[double brackets]].`;
                const result = await callPollinationsAI(`WORKSPACE NOTES:\n${noteContent}`, sys);
                if (result && result.trim()) {
                    const lines = result.trim().split('\n');
                    const titleLine = lines.find(l => l.startsWith('# '));
                    const newTitle = titleLine ? titleLine.replace('# ', '').trim() : ' Workspace Summary';
                    const newBody = result.trim();
                    const summaryNote = {
                        id: 'summary-' + Date.now(),
                        title: newTitle,
                        body: newBody,
                        tags: 'ai-generated, summary, index',
                        timestamp: new Date().toLocaleDateString(),
                        workspaceId: state.activeWorkspace
                    };
                    state.notes.unshift(summaryNote);
                    saveDataToDB(); renderNotesList();
                    if (area) area.innerHTML = `<div class="text-center py-6"><div class="text-3xl mb-3"></div><p class="text-sm text-textMain font-semibold">Master summary note created!</p><p class="text-xs text-textMuted mt-2">Find "${newTitle}" at the top of your notes list.</p></div>`;
                    toast(' Summary note created!', 'success');
                }
            } catch (err) {
                if (area) area.innerHTML = `<div class="text-red-400 text-sm text-center py-6">Error: ${err.message}</div>`;
                toast('AI error: ' + err.message, 'error');
            }
        }

        /* ── UI/UX: Close synthesis panel on outside click ──────────── */
        document.getElementById('ai-synthesis-panel')?.addEventListener('click', function(e) {
            if (e.target === this) closeAISynthesisPanel();
        });
