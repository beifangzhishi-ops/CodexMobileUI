import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { HostId } from './types';
import { MessageImage } from './MessageImage';
import { localFileName, renderableLocalFileLinks } from '../../shared/localFileLinks';
import { desktopBridge } from './desktopBridge';
import { renderAssistantImageReferences } from '../server/assistantImageRefs.mjs';

/** Local assistant paths stay native in history and render as filenames. */
export function MessageMarkdown({ text, onCopyPath, hostId, threadId, itemId,
  readAssistantImage, onOpenImage, onOpenFile, onRevealFile, displayPath, imageReady = true }: {
  text: string;
  onCopyPath?: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onRevealFile?: (path: string) => void;
  displayPath?: (path: string) => string;
  hostId?: HostId;
  threadId?: string;
  itemId?: string;
  readAssistantImage?: (hostId: HostId, threadId: string, itemId: string, index: number) => Promise<Blob>;
  onOpenImage?: (url: string) => void;
  imageReady?: boolean;
}) {
  const preview = renderAssistantImageReferences(text);
  const parsed = renderableLocalFileLinks(preview.markdown);
  function imagePreview(index: number) {
    const ref = preview.images[index];
    if (!ref) return null;
    return <span className="assistant-image-reference">
      {!imageReady ? <span className="history-image-loading">正在生成图片</span> :
        hostId && threadId && itemId && readAssistantImage && onOpenImage
        ? <MessageImage hostId={hostId} threadId={threadId} itemId={itemId}
            imageIndex={index} readImage={readAssistantImage} onOpen={onOpenImage}/>
        : <span className="unresolved-file-link">图片预览不可用</span>}
      <button className="assistant-image-path" type="button" title="复制图片绝对路径"
        onClick={() => onCopyPath?.(displayPath?.(ref.path) ?? ref.path)}>{localFileName(ref.path)}</button>
    </span>;
  }
  return <div className="message-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}
      components={{
        a: ({ href, children }) => {
          const image = /^https:\/\/codexmobile\.invalid\/assistant-image\/(\d+)$/.exec(href ?? '');
          if (image) return imagePreview(Number(image[1]));
          const link = href ? parsed.targets[href] : undefined;
          if (link) {
            const { path, location } = link;
            const copyPath = displayPath?.(path) ?? path;
            const mobile = !desktopBridge() && typeof window !== 'undefined' &&
              (window.matchMedia('(max-width: 800px)').matches ||
                typeof (window as Window & { ReactNativeWebView?: {
                  postMessage: (data: string) => void
                } }).ReactNativeWebView?.postMessage === 'function');
            return <span className="assistant-file-actions context-press-target"
              data-context-kind="file" data-context-host={hostId} data-context-id={path}
              data-context-origin="assistant">
              <button className="local-file-link" type="button"
                title={mobile ? '下载文件' : onRevealFile ? '在资源管理器中定位' : '复制绝对路径'}
                onClick={() => mobile ? onOpenFile?.(path) : onRevealFile ? onRevealFile(path) : onCopyPath?.(copyPath)}>
                {localFileName(path)}{location}
              </button>
              {!mobile && onRevealFile && <button type="button" className="assistant-file-download"
                title="复制当前电脑可读路径" aria-label="复制路径"
                onClick={() => onCopyPath?.(copyPath)}>复制</button>}
              {!mobile && onOpenFile && <button type="button" className="assistant-file-download"
                title="下载文件" aria-label="下载文件" onClick={() => onOpenFile(path)}>下载</button>}
            </span>;
          }
          return href && /^https?:\/\//i.test(href)
            ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
            : <span className="unresolved-file-link">{children}</span>;
        },
        img: ({ alt, src }) => {
          const image = /^https:\/\/codexmobile\.invalid\/assistant-image\/(\d+)$/.exec(src ?? '');
          return image ? imagePreview(Number(image[1])) :
            <span className="unresolved-file-link">{alt || '图片'}</span>;
        },
      }}>
      {parsed.markdown}
    </ReactMarkdown>
  </div>;
}
