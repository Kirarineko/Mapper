import { useState } from 'react'
import {
  AREA_TOOLS,
  LINE_TOOLS,
  TOOL_NAMES,
  toolGroup,
  useAppStore,
  type ToolId,
} from '../store/appStore'
import { Bubble, MdIconButton, MdMenu } from './md'
import { IconAreaTool, IconLineTool } from './icons'
import { TOOL_ICONS } from './TopBar'

/** 每个工具组记住上次使用的子工具 */
const lastTool: Record<'line' | 'area', ToolId> = { line: 'straight', area: 'brush' }

export function ToolRail() {
  const activeTool = useAppStore((state) => state.activeTool)
  const setTool = useAppStore((state) => state.setTool)
  const [menu, setMenu] = useState<'line' | 'area' | null>(null)

  const groups = [
    { group: 'line' as const, label: '线测量', icon: <IconLineTool />, tools: LINE_TOOLS },
    { group: 'area' as const, label: '面测量', icon: <IconAreaTool />, tools: AREA_TOOLS },
  ]

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-outline-variant bg-surface-container py-2">
      {groups.map(({ group, label, icon, tools }) => {
        const selected = toolGroup(activeTool) === group
        if (selected) lastTool[group] = activeTool
        return (
          <div key={group} className="relative">
            <MdIconButton
              label={`${label}（左键启用，右键选择子工具）`}
              selected={selected}
              onClick={() => setTool(lastTool[group])}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu(menu === group ? null : group)
              }}
            >
              {icon}
            </MdIconButton>
            <span className="md3-label-small pointer-events-none mt-0.5 block text-center text-on-surface-variant">
              {label}
            </span>
            {menu === group && (
              <Bubble className="left-14 top-0 !p-0" style={{ transformOrigin: 'top left' }} onDismiss={() => setMenu(null)}>
                <MdMenu
                  items={tools.map((tool) => {
                    const Icon = TOOL_ICONS[tool]
                    return {
                      key: tool,
                      label: TOOL_NAMES[tool],
                      icon: <Icon width={18} height={18} />,
                      onSelect: () => {
                        lastTool[group] = tool
                        setTool(tool)
                        setMenu(null)
                      },
                    }
                  })}
                />
              </Bubble>
            )}
          </div>
        )
      })}
    </nav>
  )
}
