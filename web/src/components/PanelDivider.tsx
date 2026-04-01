import { useCallback, useRef } from 'react'
import { useUiStore } from '../stores/uiStore'

export default function PanelDivider() {
  const setWidth = useUiStore(s => s.setRightPanelWidth)
  const dividerRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = useUiStore.getState().rightPanelWidth
      const div = dividerRef.current
      div?.classList.add('active')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMouseMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX
        setWidth(startWidth + delta)
      }

      const onMouseUp = () => {
        div?.classList.remove('active')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [setWidth],
  )

  return (
    <div
      ref={dividerRef}
      onMouseDown={onMouseDown}
      className="panel-divider w-1.5 flex-shrink-0 bg-gray-800/60 hover:bg-accent-cyan/25 active:bg-accent-cyan/40 transition-colors relative group"
    >
      {/* Visual grip dots */}
      <div className="absolute inset-y-0 left-0 right-0 flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="w-0.5 h-0.5 rounded-full bg-gray-500" />
        <div className="w-0.5 h-0.5 rounded-full bg-gray-500" />
        <div className="w-0.5 h-0.5 rounded-full bg-gray-500" />
      </div>
    </div>
  )
}
