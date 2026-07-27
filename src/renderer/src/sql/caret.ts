/** Copied onto the mirror so it wraps text exactly like the textarea does. */
const MIRRORED = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
  'lineHeight', 'textTransform', 'wordSpacing', 'tabSize'
] as const

let mirror: HTMLDivElement | null = null

/**
 * Pixel offset of a caret index inside a textarea, relative to the element's
 * top-left (scrolling accounted for). Measured with an off-screen div that
 * mirrors the textarea's box and typography — there is no DOM API for this.
 */
export function caretOffset(
  ta: HTMLTextAreaElement,
  index: number
): { left: number; top: number; lineHeight: number } {
  if (!mirror) {
    mirror = document.createElement('div')
    mirror.setAttribute('aria-hidden', 'true')
    document.body.appendChild(mirror)
  }
  const cs = window.getComputedStyle(ta)
  const style = mirror.style
  style.position = 'absolute'
  style.visibility = 'hidden'
  style.top = '0'
  style.left = '-9999px'
  style.whiteSpace = 'pre-wrap'
  style.overflowWrap = 'break-word'
  for (const prop of MIRRORED) style[prop] = cs[prop]

  mirror.textContent = ta.value.slice(0, index)
  const marker = document.createElement('span')
  marker.textContent = ta.value.slice(index) || '.'
  mirror.appendChild(marker)

  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4
  const left = marker.offsetLeft - ta.scrollLeft
  const top = marker.offsetTop - ta.scrollTop
  mirror.textContent = ''
  return { left, top, lineHeight }
}
