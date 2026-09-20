/* --- KANBAN --- */
async function addKanbanTask() { 
    const data = await showModal({ 
        title: 'New Task', type: 'form', 
        fields: [{ id: 'title', label: 'Task Name', type: 'text' }, { id: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Normal', 'High'] }, { id: 'due', label: 'Due Date (Optional)', type: 'date' }] 
    });
    if(!data || !data.title) return; 
    state.kanban.todo.push({ id: 'task-' + Date.now(), title: data.title, priority: data.priority, due: data.due, workspaceId: state.activeWorkspace }); saveDataToDB(); renderKanban(); 
}

function renderKanban() {
    const pColors = { 'High': 'text-red-400 border-red-400/30 bg-red-400/10', 'Normal': 'text-blue-400 border-blue-400/30 bg-blue-400/10', 'Low': 'text-gray-400 border-borderDark bg-borderDark' };
    ['todo', 'progress', 'done'].forEach(col => {
        const tasks = state.kanban[col].filter(t => t.workspaceId === state.activeWorkspace);
        document.getElementById(`count-${col}`).innerText = tasks.length;
        document.getElementById(`kb-${col}`).innerHTML = tasks.map(task => `
            <div class="glass-bg border border-borderDark p-4 md:p-3 rounded-lg shadow-sm cursor-grab active:cursor-grabbing text-sm flex flex-col group relative lift" draggable="true" ondragstart="dragCard(event, '${task.id}', '${col}')" ondragend="this.classList.remove('kb-dragging-source')" data-task-id="${task.id}" data-task-col="${col}">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-medium text-textMain text-base md:text-sm">${task.title}</span>
                    <div class="flex gap-1 shrink-0">
                        <button onclick="moveTaskMobile('${task.id}', '${col}')" class="kb-move-btn md:hidden text-textMuted hover:text-accent transition text-xl px-2 opacity-100">↔</button>
                        <button onclick="deleteTask('${task.id}', '${col}')" class="text-textMuted hover:text-red-400 transition text-xl md:text-sm px-2 md:px-0 opacity-100 md:opacity-0 md:group-hover:opacity-100">✕</button>
                    </div>
                </div>
                <div class="flex items-center gap-2 mt-auto pt-2 border-t border-borderDark/50">
                    <span class="text-[10px] px-2 py-0.5 rounded border ${pColors[task.priority || 'Normal']}">${task.priority || 'Normal'}</span>
                    ${task.due ? (() => { const dDate = new Date(task.due); const today = new Date(); today.setHours(0,0,0,0); const diff = Math.round((dDate-today)/86400000); const cls = diff < 0 ? 'text-red-400' : diff === 0 ? 'text-orange-400' : 'text-textMuted'; const label = diff < 0 ? `Overdue ${Math.abs(diff)}d` : diff === 0 ? 'Due today' : `${diff}d left`; return `<span class="text-[10px] ${cls} flex items-center gap-1">⏱ ${label}</span>`; })() : ''}
                </div>
            </div>`).join('');
    });
}
function deleteTask(id, col) { state.kanban[col] = state.kanban[col].filter(t => t.id !== id); saveDataToDB(); renderKanban(); }

async function moveTaskMobile(id, sourceCol) {
    const cols = ['todo', 'progress', 'done'];
    const options = cols.filter(c => c !== sourceCol);
    const data = await showModal({
        title: 'Move Task', type: 'form',
        fields: [{id: 'dest', label: 'Move to:', type: 'select', options: options}]
    });
    if(data && data.dest) {
        const taskIndex = state.kanban[sourceCol].findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            const task = state.kanban[sourceCol].splice(taskIndex, 1)[0];
            state.kanban[data.dest].push(task);
            if(data.dest === 'done') trackActivity('tasks'); 
            saveDataToDB(); renderKanban();
        }
    }
}

function dragCard(ev, id, sourceCol) {
    ev.dataTransfer.setData("id", id);
    ev.dataTransfer.setData("source", sourceCol);
    ev.dataTransfer.effectAllowed = "move";

    // Do not hand Chromium/WebKit a DOM clone as a drag image. On HiDPI
    // WebViews that preview can be rasterized at devicePixelRatio and appear
    // 2x (or larger), which is exactly the oversized card seen in builds.
    // Keep the native drag operation, but use a transparent 1x1 preview.
    // The source card remains visibly dimmed while dragging.
    if (ev.dataTransfer.setDragImage) {
        let img = document.getElementById('kb-transparent-drag-image');
        if (!img) {
            img = document.createElement('canvas');
            img.id = 'kb-transparent-drag-image';
            img.width = 1;
            img.height = 1;
            img.style.position = 'fixed';
            img.style.left = '-100px';
            img.style.top = '-100px';
            img.style.width = '1px';
            img.style.height = '1px';
            img.style.pointerEvents = 'none';
            document.body.appendChild(img);
        }
        ev.dataTransfer.setDragImage(img, 0, 0);
        ev.currentTarget?.classList.add('kb-dragging-source');
    }
}

function allowDrop(ev, el) { ev.preventDefault(); if(el) el.classList.add('kb-col-active'); }
function leaveDrop(el) { if(el) el.classList.remove('kb-col-active'); }
function dropCard(ev, targetCol, el) {
    ev.preventDefault(); if(el) el.classList.remove('kb-col-active');
    const id = ev.dataTransfer.getData("id"); const sourceCol = ev.dataTransfer.getData("source");
    if(!sourceCol || !id || sourceCol === targetCol) return;
    const taskIndex = state.kanban[sourceCol].findIndex(t => t.id === id); if (taskIndex === -1) return; 
    const task = state.kanban[sourceCol].splice(taskIndex, 1)[0]; state.kanban[targetCol].push(task); 
    if(targetCol === 'done') trackActivity('tasks'); 
    saveDataToDB(); renderKanban();
}

/* --- POMODORO & FOCUS GUARD --- */
