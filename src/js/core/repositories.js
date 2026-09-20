/* Typed frontend repository facade.
 *
 * Feature modules call Graphite.repositories.<domain> rather than invoking
 * Tauri commands directly. Browser builds remain untouched: callers can use
 * isAvailable() to keep IndexedDB as the compatibility path during migration.
 */
(function () {
  const Graphite = window.Graphite = window.Graphite || {};

  function native(command, args) {
    if (!Graphite.native?.available) throw new Error('SQLite repositories require the Tauri runtime.');
    return Graphite.native.invoke(command, args);
  }

  const softDelete = (command) => (id, hard = false) => native(command, { id, hard });

  Graphite.repositories = {
    isAvailable: () => Boolean(Graphite.native?.available && Graphite.database?.isAvailable?.()),
    workspaces: {
      list: (includeArchived = false) => native('repository_workspace_list', { includeArchived }),
      get: (id) => native('repository_workspace_get', { id }),
      upsert: (input) => native('repository_workspace_upsert', { input }),
      remove: (id) => native('repository_workspace_delete', { id })
    },
    notes: {
      list: (workspaceId, includeDeleted = false) => native('repository_note_list', { workspaceId, includeDeleted }),
      get: (id) => native('repository_note_get', { id }),
      upsert: (input) => native('repository_note_upsert', { input }),
      remove: softDelete('repository_note_delete')
    },
    tasks: {
      list: (workspaceId, includeDeleted = false) => native('repository_task_list', { workspaceId, includeDeleted }),
      get: (id) => native('repository_task_get', { id }),
      upsert: (input) => native('repository_task_upsert', { input }),
      remove: softDelete('repository_task_delete')
    },
    calendar: {
      list: (workspaceId, fromAt = null, toAt = null, includeDeleted = false) => native('repository_calendar_list', { workspaceId, fromAt, toAt, includeDeleted }),
      get: (id) => native('repository_calendar_get', { id }),
      upsert: (input) => native('repository_calendar_upsert', { input }),
      remove: softDelete('repository_calendar_delete')
    },
    flashcards: {
      list: (workspaceId, dueBefore = null, includeDeleted = false) => native('repository_flashcard_list', { workspaceId, dueBefore, includeDeleted }),
      get: (id) => native('repository_flashcard_get', { id }),
      upsert: (input) => native('repository_flashcard_upsert', { input }),
      remove: softDelete('repository_flashcard_delete'),
      recordReview: (input) => native('repository_flashcard_review', { input })
    },
    sessions: {
      list: (workspaceId, fromAt = null, toAt = null) => native('repository_session_list', { workspaceId, fromAt, toAt }),
      get: (id) => native('repository_session_get', { id }),
      upsert: (input) => native('repository_session_upsert', { input })
    }
  };
})();
