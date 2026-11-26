import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { saveViewerImage, type ImageViewerSource } from './imageViewer';
import type { MenuPoint } from './useImageLongPress';

export function ImageViewerSaveActions({ source, menuPoint, onCloseMenu }: {
  source: ImageViewerSource;
  menuPoint: MenuPoint | null;
  onCloseMenu: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setBusy(false);
    setProgress(null);
    setStatus(null);
    setFailed(false);
    return () => controllerRef.current?.abort();
  }, [source.key]);

  async function save() {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setFailed(false);
    setStatus('正在准备图片');
    setProgress(null);
    onCloseMenu();
    try {
      await saveViewerImage(source, (received, total) => {
        if (!controller.signal.aborted) {
          setProgress(Math.round(received / total * 100));
          setStatus('正在保存图片');
        }
      }, controller.signal);
      if (!controller.signal.aborted) {
        setProgress(null);
        setStatus('图片已保存');
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailed(true);
        setProgress(null);
        setStatus(error instanceof Error && error.message.includes('CANCEL')
          ? '已取消保存' : '图片保存失败，请重试');
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(false);
      }
    }
  }

  const menuLeft = menuPoint ? Math.max(8,
    Math.min(menuPoint.x, window.innerWidth - 176)) : 0;
  const menuTop = menuPoint ? Math.max(8,
    Math.min(menuPoint.y, window.innerHeight - 68)) : 0;
  return <>
    <div className="image-viewer-save-toolbar">
      <button type="button" className="image-viewer-save" disabled={busy}
        aria-label="保存图片" autoFocus
        onClick={() => void save()}>
        <Download size={17}/>
        {busy ? (progress === null ? '准备中' : progress + '%') : '保存图片'}
      </button>
      {status && <span role={failed ? 'alert' : 'status'}>{status}</span>}
    </div>
    {menuPoint && <div className="image-viewer-save-menu" role="menu" aria-label="图片操作"
      style={{ left: menuLeft, top: menuTop }}>
      <button type="button" role="menuitem" autoFocus disabled={busy}
        onClick={() => void save()}>
        <Download size={16}/>保存图片
      </button>
    </div>}
  </>;
}
