/// <reference types="vite/client" />
import type { Api } from '@shared/types'

declare global {
  interface Window {
    api: Api
  }
  // React 19 moved JSX into the React namespace; re-expose the bits we use.
  namespace JSX {
    type Element = import('react').JSX.Element
    type IntrinsicElements = import('react').JSX.IntrinsicElements
    type ElementClass = import('react').JSX.ElementClass
  }
}

export {}
