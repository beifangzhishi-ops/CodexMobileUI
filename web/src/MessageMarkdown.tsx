import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { HostId } from './types';
import { MessageImage } from './MessageImage';
import { localFileName, renderableLocalFileLinks } from '../../shared/localFileLinks';
import { hasNativePublicationDownload } from './publicationDownload';
import { renderAssistantImageReferences } from '../server/assistantImageRefs.mjs';

/** Local assistant paths stay native in history and render as filenames. */
export function MessageMarkdown({ text, onCopyPath, hostId, threadId, itemId,
  readAssistantImage, onOpenImage, onOpenFile, onRevealFile, displayPath, imageReady = true }: {
  text: string;
  onCopyPath?: (path: string) => void;
  onOpenFile?: (path: string, linkIndex: number) => void;
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
  const mobile = hasNativePublicationDownload() && !onRevealFile;
  const copyPath = (path: string) => onCopyPath?.(displayPath?.(path) ?? path);
  const activatePath = (path: string) => {
    if (onRevealFile) onRevealFile(path);
    else copyPath(path);
  };
  function imagePreview(index: number) {
    const ref = preview.images[index];
    if (!ref) return null;
    return <span className="assistant-image-reference">
      {!imageReady ? <span className="history-image-loading">正在生成图片</span> :
        hostId && threadId && itemId && readAssistantImage && onOpenImage
        ? <MessageImage hostId={hostId} threadId={threadId} itemId={itemId}
            imageIndex={index} readImage={readAssistantImage} onOpen={onOpenImage}/>
        : <span className="unresolved-file-link">图片预览不可用</span>}
      {!mobile && <button className="assistant-image-path" type="button" title={displayPath?.(ref.path) ?? ref.path}
        onClick={() => activatePath(ref.path)}>{localFileName(ref.path)}</button>}
      {onRevealFile && <button type="button" className="assistant-file-download"
        aria-label="复制图片路径" onClick={() => copyPath(ref.path)}>复制</button>}
    </span>;
  }
  return <div className="message-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}
      components={{
        a: ({ href, children }) => {
          const link = href ? parsed.targets[href] : undefined;
          if (link) {
            const { path } = link;
            return <span className="assistant-file-actions context-press-target"
              data-context-kind="file" data-context-host={hostId} data-context-id={path}
              data-context-origin="assistant" data-context-item={itemId}
              data-context-link-index={link.index}>
              <button className="local-file-link" type="button"
                title={mobile ? '打开文件预览与保存' : onRevealFile ? '打开文件预览' : '打开私有文件预览'}
                onClick={() => onOpenFile ? onOpenFile(path, link.index) : activatePath(path)}>
                {children}
              </button>
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
