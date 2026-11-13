import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useTheme } from '@/contexts/ThemeContext'

export function Toaster(props: ToasterProps) {
  const { resolved } = useTheme()
  return (
    <Sonner
      theme={resolved}
      position="top-center"
      toastOptions={{
        classNames: {
          toast: '!rounded-2xl !border !bg-popover !text-popover-foreground !shadow-xl',
          description: '!text-muted-foreground',
        },
      }}
      {...props}
    />
  )
}
