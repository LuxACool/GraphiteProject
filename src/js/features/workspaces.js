/* =========================================
   WORKSPACE MANAGEMENT
   ========================================= */
function toggleWorkspaceDropdown() {
    const dropdown = document.getElementById('ws-dropdown');
    dropdown.classList.toggle('hidden');
    document.getElementById('ws-dropdown-icon').innerText = dropdown.classList.contains('hidden') ? '▼' : '▲';
    if(!dropdown.classList.contains('hidden')) renderWorkspaceDropdown();
}

function renderWorkspaceDropdown() {
    const list = document.getElementById('ws-list');
    list.innerHTML = state.workspaces.map(w => `
        <div class="px-4 py-3 hover:bg-black/20 cursor-pointer flex items-center justify-between group" onclick="switchWorkspace('${w.id}')">
            <div class="flex items-center gap-3">
                <div class="w-3 h-3 rounded-full" style="background-color: ${w.color}"></div>
                <span class="text-sm ${w.id === state.activeWorkspace ? 'text-accent font-bold' : 'text-textMuted group-hover:text-textMain'}">${w.name}</span>
            </div>
            ${state.workspaces.length > 1 ? `<button onclick="deleteWorkspace(event, '${w.id}')" class="text-red-400 opacity-0 group-hover:opacity-100 text-sm font-bold px-2 py-1 rounded hover:bg-red-400/20"></button>` : ''}
        </div>
    `).join('');
}

function switchWorkspace(id) {
    const ws = state.workspaces.find(w => w.id === id); if(!ws) return;
    state.activeWorkspace = id;
    document.getElementById('ws-name-display').innerText = ws.name; document.getElementById('breadcrumb-ws').innerText = ws.name;
    document.getElementById('ws-color-indicator').style.backgroundColor = ws.color;
    toggleWorkspaceDropdown(); saveDataToDB(); switchApp(ws.lastApp || 'dashboard'); bootOS();
}

async function createNewWorkspace() {
    const data = await showModal({
        title: 'New Workspace', type: 'form',
        fields: [{ id: 'name', label: 'Workspace Name', type: 'text', placeholder: 'e.g. AI Research' }, { id: 'color', label: 'Color Hex', type: 'text', defaultValue: '#10b981' }]
    });
    if(!data || !data.name) return;
    const newWs = { id: 'ws-' + Date.now(), name: data.name, color: data.color || '#10b981', lastApp: 'dashboard', focusMinutes: 0 };
    state.workspaces.push(newWs); state.calendarBlocks[newWs.id] = {};
    saveDataToDB(); switchWorkspace(newWs.id);
}

async function deleteWorkspace(e, id) {
    e.stopPropagation();
    if(state.workspaces.length <= 1) return toast("Cannot delete the last workspace.");
    if(!await showModal({title: 'Delete Workspace?', content: 'All associated notes, tasks, and data will be permanently lost.', type: 'confirm'})) return;

    state.workspaces = state.workspaces.filter(w => w.id !== id);
    state.notes = state.notes.filter(n => n.workspaceId !== id);
    ['todo','progress','done'].forEach(col => state.kanban[col] = state.kanban[col].filter(t => t.workspaceId !== id));
    state.flashcards = state.flashcards.filter(f => f.workspaceId !== id);
    state.canvasStrokes = state.canvasStrokes.filter(s => s.workspaceId !== id);
    delete state.calendarBlocks[id];

    if(state.activeWorkspace === id) state.activeWorkspace = state.workspaces[0].id;
    saveDataToDB(); switchWorkspace(state.activeWorkspace);
}

async function openGlobalCapture() {
    const data = await showModal({
        title: 'Global Capture', type: 'form',
        fields: [
            { id: 'type', label: 'Type', type: 'select', options: ['Note', 'Task', 'Flashcard'] },
            { id: 'workspace', label: 'Destination Workspace', type: 'select', options: state.workspaces.map(w => w.name), defaultValue: state.workspaces.find(w=>w.id===state.activeWorkspace).name },
            { id: 'title', label: 'Content (Title/Question/Task)', type: 'text' },
            { id: 'desc', label: 'Description (Body/Answer - Optional)', type: 'text' }
        ]
    });
    if(!data || !data.title) return;
    const wsId = state.workspaces.find(w => w.name === data.workspace).id;

    if(data.type === 'Note') state.notes.unshift({ id: Date.now().toString(), title: data.title, body: data.desc || '', tags: 'capture', timestamp: new Date().toLocaleDateString(), workspaceId: wsId });
    else if (data.type === 'Task') state.kanban.todo.push({ id: 'task-' + Date.now(), title: data.title, priority: 'Normal', due: '', workspaceId: wsId });
    else if (data.type === 'Flashcard') state.flashcards.push({ id: Date.now().toString(), q: data.title, a: data.desc || '', rep: 0, int: 1, ef: 2.5, next: Date.now(), workspaceId: wsId });

    saveDataToDB(); toast('Captured to ' + data.workspace); bootOS();
}
