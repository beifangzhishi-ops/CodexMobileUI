import { useEffect, useRef, useState } from 'react';
import type { HostId } from './types';

export function VisualizeFrame({ host, thread, item, index, title, wide, ready }: {
  host: HostId; thread: string; item: string; index: number;
  title?: string; wide: boolean; ready: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(144);
  const inAndroidShell = Boolean(Reflect.get(window, 'ReactNativeWebView')) ||
    /\bAndroid\b.*; wv\)/.test(navigator.userAgent);
  const [shellReady, setShellReady] = useState(() =>
    Reflect.get(window, 'codexMobileVisualizeReady') === true);

  useEffect(() => {
    const onShellReady = () => setShellReady(Reflect.get(window, 'codexMobileVisualizeReady') === true);
    const onHeight = (event: MessageEvent) => {
      if (event.origin !== 'null' || event.source !== frame.current?.contentWindow ||
          event.data?.type !== 'codexmobileui:visualize-height' ||
          !Number.isFinite(event.data.height)) return;
      setHeight(Math.max(36, Math.min(1800, Math.ceil(event.data.height))));
    };
    window.addEventListener('codexmobileui:visualize-ready', onShellReady);
    window.addEventListener('message', onHeight);
    onShellReady();
    return () => {
      window.removeEventListener('codexmobileui:visualize-ready', onShellReady);
      window.removeEventListener('message', onHeight);
    };
  }, []);

  if (!ready) return <span className="visualize-status" role="status">正在生成互动组件…</span>;
  if (inAndroidShell && !shellReady) return <span className="visualize-status" role="status">
    当前 Android App 版本无法显示互动组件。
  </span>;
  const query = new URLSearchParams({ host, thread, item, index: String(index) });
  return <iframe ref={frame} className={'visualize-frame' + (wide ? ' visualize-wide' : '')}
    title={title || '互动组件'} src={'/api/visualize?' + query}
    sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" height={height}/>;
}
