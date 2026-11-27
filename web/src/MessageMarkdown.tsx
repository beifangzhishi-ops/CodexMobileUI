import ReactMarkdown from 'react-markdown';
import { createContext, useContext, type ReactNode } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { remarkTexDelimiters } from './remarkTexDelimiters.mjs';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { HostId } from './types';
import { MessageImage } from './MessageImage';
import { localFileName, renderableLocalFileLinks } from '../../shared/localFileLinks';
import { hasNativePublicationDownload } from './publicationDownload';
import type { ImageViewerSource } from './imageViewer';
import { renderAssistantImageReferences } from '../server/assistantImageRefs.mjs';
import { visualizeReferences } from '../../shared/visualizeReferences';
import { VisualizeFrame } from './VisualizeFrame';

const MessageLink = createContext<(href: string | undefined, children: ReactNode) => ReactNode>(() => null);

function MarkdownAnchor({ href, children }: { href?: string; children?: ReactNode }) {
  return useContext(MessageLink)(href, children);
}

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
  onOpenImage?: (source: ImageViewerSource) => void;
  imageReady?: boolean;
}) {
  const references = hostId && threadId && itemId ? visualizeReferences(text) : [];
  let visualizeLink = 'https://codexmobile.invalid/visualize/';
  while (references.length && text.includes(visualizeLink)) visualizeLink += '_';
  let markdown = text;
  for (let index = references.length - 1; index >= 0; index--) {
    const { start, end } = references[index];
    markdown = markdown.slice(0, start) + '\n\n[互动组件](' + visualizeLink + index + ')\n\n' +
      markdown.slice(end);
  }
  const preview = renderAssistantImageReferences(markdown);
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
            imageIndex={index} readImage={readAssistantImage} onOpen={onOpenImage}
            nameHint={localFileName(ref.path)}/>
        : <span className="unresolved-file-link">图片预览不可用</span>}
      {!mobile && <button className="assistant-image-path" type="button" title={displayPath?.(ref.path) ?? ref.path}
        onClick={() => activatePath(ref.path)}>{localFileName(ref.path)}</button>}
      {onRevealFile && <button type="button" className="assistant-file-download"
        aria-label="复制图片路径" onClick={() => copyPath(ref.path)}>复制</button>}
    </span>;
  }
  const renderLink = (href: string | undefined, children: ReactNode) => {
    if (hostId && threadId && itemId && href?.startsWith(visualizeLink)) {
      const index = Number(href.slice(visualizeLink.length));
      const visual = references[index];
      if (visual) return <VisualizeFrame host={hostId} thread={threadId} item={itemId}
        index={index} title={visual.title} wide={visual.wide} ready={imageReady}/>;
    }
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
  };
  return <MessageLink.Provider value={renderLink}><div className="message-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkTexDelimiters]} rehypePlugins={[rehypeKatex]}
      components={{
        a: MarkdownAnchor,
        img: ({ alt, src }) => {
          const image = /^https:\/\/codexmobile\.invalid\/assistant-image\/(\d+)$/.exec(src ?? '');
          return image ? imagePreview(Number(image[1])) :
            <span className="unresolved-file-link">{alt || '图片'}</span>;
        },
      }}>
      {parsed.markdown}
    </ReactMarkdown>
  </div></MessageLink.Provider>;
}
