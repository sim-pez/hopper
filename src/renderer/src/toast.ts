import { uid } from './utils'

export type ToastKind = 'error' | 'success' | 'info'

export interface Toast {
  id: string
  message: string
  kind: ToastKind
}

type Listener = (toasts: Toast[]) => void

let toasts: Toast[] = []
const listeners = new Set<Listener>()

function emit(): void {
  listeners.forEach((l) => l(toasts))
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

/** Show a toast; errors stay up longer than info/success. */
export function showToast(message: string, kind: ToastKind = 'info'): void {
  const id = uid()
  toasts = [...toasts, { id, message, kind }]
  emit()
  setTimeout(() => dismissToast(id), kind === 'error' ? 6000 : 3500)
}
