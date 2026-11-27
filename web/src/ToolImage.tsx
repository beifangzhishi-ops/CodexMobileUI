import { useCallback } from 'react';
import { MessageImage } from './MessageImage';
import type { HostId } from './types';
import type { ImageViewerSource } from './imageViewer';

export function ToolImage({ hostId, threadId, turnId, itemId, readToolImage, onOpen, nameHint }: {
  hostId: HostId; threadId: string; turnId: string; itemId: string;
  readToolImage: (hostId: HostId, threadId: string, turnId: string, itemId: string) => Promise<Blob>;
  onOpen: (source: ImageViewerSource) => void;
  nameHint?: string;
}) {
  const readImage = useCallback((host: HostId, thread: string, item: string) =>
    readToolImage(host, thread, turnId, item), [readToolImage, turnId]);
  return <MessageImage hostId={hostId} threadId={threadId} itemId={itemId}
    imageIndex={0} readImage={readImage} onOpen={onOpen} nameHint={nameHint}/>;
}
