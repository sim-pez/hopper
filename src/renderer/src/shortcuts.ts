/**
 * Shortcut labels for the UI. The handlers all accept either modifier
 * (`e.metaKey || e.ctrlKey`); only what we *show* the user differs per platform.
 */
const mac = window.api.system.platform === 'darwin'

export const IS_MAC = mac

/** Run the statement at the caret. */
export const KEY_RUN = mac ? '⌘↵' : 'Ctrl+Enter'
/** Run the whole editor. */
export const KEY_RUN_ALL = mac ? '⌘⇧↵' : 'Ctrl+Shift+Enter'
/** Toggle the row detail panel. */
export const KEY_ROW_DETAIL = mac ? '⌘⇧E' : 'Ctrl+Shift+E'
