import { Toaster as SonnerToaster } from '@/components/ui/sonner';
import { useTheme } from '@/theme/theme-provider';

/** Глобальный тостер: тема берётся из нашего ThemeProvider. */
export function Toaster() {
  const { resolvedTheme } = useTheme();
  return <SonnerToaster theme={resolvedTheme} richColors position="bottom-center" closeButton />;
}
