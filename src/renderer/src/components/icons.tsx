import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function base(props: IconProps): IconProps {
  return {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...props,
  }
}

export const IconFolder = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)

export const IconMap = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
    <path d="M9 4v14M15 6v14" />
  </svg>
)

export const IconSettings = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.22.62.83 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
  </svg>
)

export const IconRuler = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="2.5" y="9" width="19" height="6" rx="1" />
    <path d="M6 9v2.5M10 9v2.5M14 9v2.5M18 9v2.5" />
  </svg>
)

export const IconUndo = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </svg>
)

export const IconRedo = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </svg>
)

export const IconDelete = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13h9l1-13" />
  </svg>
)

export const IconClose = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const IconWarning = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 3 2 21h20L12 3z" />
    <path d="M12 10v5M12 18.5v.01" />
  </svg>
)

export const IconCheck = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
)

export const IconLineTool = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M5 19 19 5" />
    <circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none" />
  </svg>
)

export const IconAreaTool = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M7 4h10l4 6-4 10H7l-4-10 4-6z" strokeDasharray="3.5 3" />
  </svg>
)

export const IconStraight = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M5 19 19 5" />
    <circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none" />
  </svg>
)

export const IconPolyline = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 18 10 8l4 6 6-9" />
    <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="10" cy="8" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="14" cy="14" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="20" cy="5" r="1.5" fill="currentColor" stroke="none" />
  </svg>
)

export const IconFreehand = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 17c2-6 4-9 6-9s1 4 3 4 3-6 7-6" />
  </svg>
)

export const IconBezier = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M5 19C5 8 19 16 19 5" />
    <path d="M5 19h4M19 5h-4" strokeDasharray="2.5 2.5" />
    <circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none" />
  </svg>
)

export const IconBrush = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m14 5 5 5-8.5 8.5a2.4 2.4 0 0 1-3.4 0l-1.6-1.6a2.4 2.4 0 0 1 0-3.4L14 5z" />
    <path d="m12 7 5 5" />
  </svg>
)

export const IconLasso = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 4c4 0 7 2.6 7 6s-3 6-7 6-7-2.6-7-6 3-6 7-6z" strokeDasharray="3.5 3" />
    <path d="M10.5 16.5c-1 2-1.5 3-3.5 3.5" />
  </svg>
)

export const IconPolygon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M7 4h10l4 6-4 10H7l-4-10 4-6z" />
    <circle cx="7" cy="4" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="17" cy="4" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="21" cy="10" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="17" cy="20" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="7" cy="20" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="3" cy="10" r="1.4" fill="currentColor" stroke="none" />
  </svg>
)

export const IconSave = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M5 3h11l5 5v13H5z" />
    <path d="M8 3v5h7V3M8 21v-8h8v8" />
  </svg>
)

export const IconExpand = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
  </svg>
)
