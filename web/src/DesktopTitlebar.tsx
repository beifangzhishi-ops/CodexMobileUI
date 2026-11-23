import { useEffect, useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import { desktopBridge } from './desktopBridge';

const titleMenus = [
  { id: 'file', text: '文件' },
  { id: 'edit', text: '编辑' },
  { id: 'view', text: '视图' },
  { id: 'window', text: '窗口' },
] as const;

export function DesktopTitlebar() {
  const desktop = desktopBridge();
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const close = () => setOpen(null);
    window.addEventListener('codexdesktop:menu-closed', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('codexdesktop:menu-closed', close);
      window.removeEventListener('blur', close);
    };
  }, []);
  if (!desktop?.openMenu) return null;
  return <header className="native-desktop-titlebar" aria-label="桌面窗口标题栏">
    <div className="native-titlebar-brand"><SquareTerminal size={20}/><strong>CodexMobile</strong></div>
    <nav className="native-titlebar-menus" aria-label="应用菜单">
      {titleMenus.map(({ id, text }) => <button key={id} type="button"
        className={open === id ? 'active' : ''} aria-label={text} aria-expanded={open === id}
        onClick={(event) => {
          setOpen(id);
          const bounds = event.currentTarget.getBoundingClientRect();
          desktop.openMenu?.(id, bounds.left, bounds.bottom);
        }}>{text}</button>)}
    </nav>
    <div className="native-titlebar-drag-space" aria-hidden="true"/>
  </header>;
}
