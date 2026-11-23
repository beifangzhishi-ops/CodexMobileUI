import { useCallback } from 'react';
import { MessageImage } from './MessageImage';
import type { HostId } from './types';

export function ToolImage({ hostId, threadId, turnId, itemId, readToolImage, onOpen }: {
  hostId: HostId; threadId: string; turnId: string; itemId: string;
  readToolImage: (hostId: HostId, threadId: string, turnId: string, itemId: string) => Promise<Blob>;
  onOpen: (url: string) => void;
}) {
  const readImage = useCallback((host: HostId, thread: string, item: string) =>
    readToolImage(host, thread, turnId, item), [readToolImage, turnId]);
  return <MessageImage hostId={hostId} threadId={threadId} itemId={itemId}
    imageIndex={0} readImage={readImage} onOpen={onOpen}/>;
}
