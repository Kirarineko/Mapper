import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react'

/* Material Design 3 常用组件的轻量实现：按钮、图标按钮、开关、对话框、气泡与菜单。 */

type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger'

const variantClasses: Record<ButtonVariant, string> = {
  filled: 'bg-primary text-on-primary',
  tonal: 'bg-secondary-container text-on-secondary-container',
  outlined: 'border border-outline text-primary bg-transparent',
  text: 'text-primary bg-transparent',
  danger: 'bg-error text-on-error',
}

interface MdButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export const MdButton = forwardRef<HTMLButtonElement, MdButtonProps>(function MdButton(
  { variant = 'filled', className = '', children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={`state-layer md3-label-large inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 transition-colors disabled:pointer-events-none disabled:opacity-40 ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
})

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean
  label: string
}

export const MdIconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function MdIconButton(
  { selected = false, label, className = '', children, ...rest },
  ref
) {
  const palette = selected
    ? 'bg-primary-container text-on-primary-container'
    : 'bg-transparent text-on-surface-variant'
  return (
    <button
      ref={ref}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className={`state-layer inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${palette} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
})

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

export function MdSwitch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-[52px] shrink-0 rounded-full border-2 transition-colors disabled:pointer-events-none disabled:opacity-40 ${
        checked ? 'border-primary bg-primary' : 'border-outline bg-surface-container-highest'
      }`}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 rounded-full transition-all ${
          checked
            ? 'left-[26px] h-6 w-6 bg-on-primary'
            : 'left-[3px] h-4 w-4 bg-outline'
        }`}
      />
    </button>
  )
}

interface DialogProps {
  open: boolean
  onClose?: () => void
  children: ReactNode
  /** 点击遮罩是否关闭（默认为是） */
  modal?: boolean
}

export function MdDialog({ open, onClose, children, modal = false }: DialogProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40"
      onMouseDown={(event) => {
        if (!modal && event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="md3-pop max-h-[85vh] min-w-[300px] max-w-[560px] overflow-auto rounded-[28px] bg-surface-container-high p-6 text-on-surface shadow-elevation-3"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export function DialogHeadline({ children }: { children: ReactNode }) {
  return <h2 className="md3-headline-small mb-4 text-on-surface">{children}</h2>
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex items-center justify-end gap-2">{children}</div>
}

interface BubbleProps extends HTMLAttributes<HTMLDivElement> {
  onDismiss?: () => void
}

/** MD3 气泡：锚定于触发元素下方的浮层，点击外部触发 onDismiss。 */
export function Bubble({ onDismiss, className = '', children, style, ...rest }: BubbleProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!onDismiss) return
    const listener = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss()
    }
    const keyListener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    // 延迟注册，避免触发打开的同一次点击立刻关闭气泡
    const timer = window.setTimeout(() => {
      window.addEventListener('mousedown', listener)
      window.addEventListener('keydown', keyListener)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousedown', listener)
      window.removeEventListener('keydown', keyListener)
    }
  }, [onDismiss])
  return (
    <div
      ref={ref}
      className={`md3-pop absolute z-40 rounded-2xl bg-surface-container-high p-4 text-on-surface shadow-elevation-2 ${className}`}
      style={style}
      {...rest}
    >
      {children}
    </div>
  )
}

export interface MenuItem {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export function MdMenu({ items }: { items: MenuItem[] }) {
  return (
    <div className="flex min-w-[180px] flex-col py-1">
      {items.map((item) => (
        <button
          key={item.key}
          disabled={item.disabled}
          onClick={item.onSelect}
          className={`state-layer md3-body-medium flex items-center gap-3 px-4 py-2.5 text-left disabled:pointer-events-none disabled:opacity-40 ${
            item.danger ? 'text-error' : 'text-on-surface'
          }`}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}

interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export function MdSegmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-full border border-outline">
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`state-layer md3-label-large px-4 py-1.5 ${
            index > 0 ? 'border-l border-outline' : ''
          } ${value === option.value ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
