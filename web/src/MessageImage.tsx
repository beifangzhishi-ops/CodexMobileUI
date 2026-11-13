import { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { HostId } from './types';

type Props = {
  hostId: HostId;
  threadId: string;
  itemId: string;
  imageIndex: number;
  readImage: (hostId: HostId, threadId: string, itemId: string, index: number) => Promise<Blob>;
  onOpen: (url: string) => void;
};

/** Resolve server-confirmed item references, never Windows filesystem paths. */
export function MessageImage({ hostId, threadId, itemId, imageIndex, readImage, onOpen }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    let blobUrl: string | null = null;
    setUrl(null);
    setError(false);
    void readImage(hostId, threadId, itemId, imageIndex).then((blob) => {
      if (disposed) return;
      blobUrl = URL.createObjectURL(blob);
      setUrl(blobUrl);
    }).catch(() => { if (!disposed) setError(true); });
    return () => {
      disposed = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [hostId, threadId, itemId, imageIndex, readImage]);

  if (error) return <div className="history-image-unavailable">
    <ImageIcon size={16} />图片暂不可用（原文件可能已被清理）
  </div>;
  if (!url) return <div className="history-image-loading">
    <span className="activity-spinner"/>正在读取图片
  </div>;
  return <button className="history-image" type="button" onClick={() => onOpen(url)}
    aria-label="查看历史图片原图" title="点击查看原图">
    <img src={url} alt="对话中上传的图片" loading="lazy"/>
  </button>;
}
