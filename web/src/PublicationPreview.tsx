import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, RotateCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type RenderTask,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { HostId } from './types';
import {
  downloadPublication, hasNativePublicationDownload, publicationUrl, publishAssistantFile,
  type HostRequest, type PublishedFile,
} from './publicationDownload';
import { useImageLongPress } from './useImageLongPress';
import { localFileName } from '../../shared/localFileLinks';
import { ImageZoomSurface } from './ImageZoomSurface';
import {
  MAX_PUBLICATION_BYTES, PUBLICATION_TEXT_PREVIEW_BYTES,
} from '../../shared/publicationProtocol';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function canPreview(file: PublishedFile): boolean {
  if (file.previewKind === 'audio' || file.previewKind === 'video') {
    return document.createElement(file.previewKind).canPlayType(file.mime) !== '';
  }
  return file.previewKind !== null;
}

function TextPreview({ file, url }: { file: PublishedFile; url: string }) {
  const [content, setContent] = useState('');
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const decoder = useRef(new TextDecoder());
  const markdown = file.previewKind === 'markdown';
  useEffect(() => {
    const controller = new AbortController();
    const end = Math.min(file.size - 1, offset + PUBLICATION_TEXT_PREVIEW_BYTES - 1);
    setStatus('loading');
    void fetch(url, { headers: { Range: `bytes=${offset}-${end}` }, signal: controller.signal })
      .then(async (response) => {
        if (response.status !== 206 || response.headers.get('content-range') !==
            `bytes ${offset}-${end}/${file.size}`) throw Error('INVALID_PREVIEW_RANGE');
        const bytes = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        if (bytes.byteLength !== end - offset + 1) throw Error('INCOMPLETE_PREVIEW');
        setContent(decoder.current.decode(bytes, { stream: !markdown && end + 1 < file.size }));
        setNextOffset(end + 1);
        setStatus('ready');
      }).catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [file.size, markdown, offset, retry, url]);
  if (status === 'error') return <div className="publication-preview-state" role="alert">
    文本预览失败 <button type="button" onClick={() => setRetry(retry + 1)}>重试</button>
  </div>;
  if (status === 'loading') return <div className="publication-preview-state" role="status">正在读取文本</div>;
  return <div className="publication-text-preview">
    {markdown ? <div className="message-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}
        components={{ img: ({ alt }) => <span>{alt}</span>, a: ({ children }) => <span>{children}</span> }}>
        {content}
      </ReactMarkdown>
    </div> : <pre>{content}</pre>}
    {nextOffset < file.size && (markdown
      ? <p className="publication-preview-notice">已显示文档开头，保存文件可查看全文。</p>
      : <button type="button" onClick={() => setOffset(nextOffset)}>读取下一段</button>)}
  </div>;
}

export type PublicationTarget = {
  hostId: HostId;
  threadId: string;
  itemId: string;
  linkIndex: number;
  path: string;
};

function statusError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('PUBLICATION_SELECTION_NOT_FOUND')) return '消息中的文件引用已变化，请刷新对话后重试';
  if (message.includes('PUBLICATION_UNAVAILABLE')) return '文件快照不存在、已过期或源文件不可读';
  if (message.includes('HOST_OFFLINE')) return '文件所在电脑未连接';
  if (message.includes('TIMEOUT')) return '文件准备超时，请重试';
  return '文件准备失败，请检查电脑连接后重试';
}

function PdfPreview({ url, name }: { url: string; name: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    setDocument(null);
    setPageNumber(1);
    setError(false);
    const loading = getDocument({ url });
    void loading.promise.then((next) => {
      if (!disposed) setDocument(next);
    }).catch(() => { if (!disposed) setError(true); });
    return () => {
      disposed = true;
      void loading.destroy();
    };
  }, [url]);
  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let disposed = false;
    let renderTask: RenderTask | null = null;
    void document.getPage(pageNumber).then((page) => {
      if (disposed || !canvasRef.current) return;
      const unscaled = page.getViewport({ scale: 1 });
      const width = canvasRef.current.parentElement?.clientWidth ?? 720;
      const scale = Math.max(0.5, Math.min(2.5, (width - 24) / unscaled.width));
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      renderTask = page.render({ canvas, viewport });
      void renderTask.promise.catch(() => undefined);
    }).catch(() => { if (!disposed) setError(true); });
    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber]);
  if (error) return <div className="publication-preview-empty" role="alert">
    <strong>PDF 预览失败</strong><span>仍可通过本端操作保存或取得文件。</span>
  </div>;
  if (!document) return <div className="publication-preview-state" role="status">
    <span className="activity-spinner"/>正在读取 PDF
  </div>;
  return <div className="publication-pdf-preview">
    <div className="publication-pdf-toolbar">
      <button type="button" disabled={pageNumber <= 1}
        onClick={() => setPageNumber((value) => Math.max(1, value - 1))}>上一页</button>
      <span>第 {pageNumber} / {document.numPages} 页 · {name}</span>
      <button type="button" disabled={pageNumber >= document.numPages}
        onClick={() => setPageNumber((value) => Math.min(document.numPages, value + 1))}>下一页</button>
    </div>
    <canvas ref={canvasRef} className="publication-pdf-canvas" aria-label={`PDF 预览：${name}`}/>
  </div>;
}

function PublicationImagePreview({ file, hostId, onSave, busy, progress }: {
  file: PublishedFile;
  hostId: HostId;
  onSave: () => void;
  busy: boolean;
  progress: number | null;
}) {
  const [revealed, setRevealed] = useState(false);
  const gesture = useImageLongPress(true, () => setRevealed(true));
  const url = publicationUrl(hostId, file.id, 'preview');
  return <div className={'publication-image-stage' + (revealed ? ' is-revealed' : '')}
    role="group" aria-label={`图片预览：${file.name}`} tabIndex={0} {...gesture}
    onKeyDown={(event) => {
      gesture.onKeyDown(event);
      if (!event.defaultPrevented && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        setRevealed(true);
      }
    }}>
    <ImageZoomSurface className="publication-preview-image" src={url} alt={file.name}/>
    <button type="button" className="publication-image-save" autoFocus={revealed}
      disabled={busy} onClick={onSave}>
      <Download size={17}/>{busy && progress !== null ? `保存中 ${progress}%` : '保存图片'}
    </button>
  </div>;
}

function PreviewContent({ file, hostId, onSaveImage, imageBusy, imageProgress }: {
  file: PublishedFile;
  hostId: HostId;
  onSaveImage: () => void;
  imageBusy: boolean;
  imageProgress: number | null;
}) {
  const url = publicationUrl(hostId, file.id, 'preview');
  if (file.previewKind === 'image') {
    return <PublicationImagePreview file={file} hostId={hostId} onSave={onSaveImage}
      busy={imageBusy} progress={imageProgress}/>;
  }
  if (file.previewKind === 'audio') {
    return <audio className="publication-preview-audio" controls preload="metadata" src={url}/>;
  }
  if (file.previewKind === 'video') {
    return <video className="publication-preview-video" controls preload="metadata" src={url}/>;
  }
  if (file.previewKind === 'document') {
    return <PdfPreview url={url} name={file.name}/>;
  }
  if (file.previewKind === 'text' || file.previewKind === 'markdown') {
    return <TextPreview key={url} file={file} url={url}/>;
  }
  if (file.previewKind === 'markup') {
    return <iframe className="publication-preview-frame" title={`文件预览：${file.name}`}
      sandbox="" src={url}/>;
  }
  return <div className="publication-preview-empty" role="status">
    <strong>此文件类型不提供内嵌预览</strong>
    <span>使用本端文件操作打开或取得私有文件。</span>
  </div>;
}

export function PublicationPreview({
  target, request, onClose, onCopyLink,
}: {
  target: PublicationTarget;
  request: HostRequest;
  onClose: () => void;
  onCopyLink: (url: string) => Promise<void>;
}) {
  const [file, setFile] = useState<PublishedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageProgress, setImageProgress] = useState<number | null>(null);
  const imageAbortRef = useRef<AbortController | null>(null);
  const android = hasNativePublicationDownload();

  const localAction = useCallback(async (file: PublishedFile) => {
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setLocalStatus(null);
    try {
      if (android) {
        await downloadPublication(target.hostId, file, request, (received, total) => {
          setProgress(Math.round(received / total * 100));
        }, controller.signal);
        if (!controller.signal.aborted) setLocalStatus('文件已保存');
      } else {
        const url = publicationUrl(target.hostId, file.id, 'download');
        await onCopyLink(url);
        setLocalStatus('已复制私有文件链接');
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        if (reason instanceof Error && reason.message.includes('CANCEL')) setLocalStatus('已取消保存');
        else setError(android ? '文件保存失败，可重新开始' : '本端文件操作失败');
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setProgress(null);
        setBusy(false);
      }
    }
  }, [android, onCopyLink, request, target.hostId]);
  const latestAction = useRef(localAction);
  useEffect(() => { latestAction.current = localAction; }, [localAction]);
  const saveImage = useCallback(async (published: PublishedFile) => {
    if (imageAbortRef.current) return;
    const controller = new AbortController();
    imageAbortRef.current = controller;
    setImageBusy(true);
    setImageProgress(null);
    setError(null);
    try {
      await downloadPublication(target.hostId, published, request, (received, total) => {
        setImageProgress(Math.round(received / total * 100));
      }, controller.signal);
      if (!controller.signal.aborted) setLocalStatus('图片已保存');
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error && reason.message.includes('CANCEL')
          ? '已取消保存图片' : '图片保存失败，请重试');
      }
    } finally {
      if (imageAbortRef.current === controller) {
        imageAbortRef.current = null;
        setImageProgress(null);
        setImageBusy(false);
      }
    }
  }, [request, target.hostId]);
  useEffect(() => {
    let active = true;
    setFile(null);
    setError(null);
    setLocalStatus(null);
    void publishAssistantFile(target.hostId, target.threadId, target.itemId,
      target.linkIndex, request).then((publication) => {
      if (!active) return;
      if (publication.status === 'ready') {
        setFile(publication);
        if (!canPreview(publication) && android) void latestAction.current(publication);
      } else setError(publication.error === 'tooLarge'
        ? '文件超过 ' + Math.round(MAX_PUBLICATION_BYTES / 1024 / 1024) + ' MiB 私有快照上限'
        : publication.error === 'missing'
          ? '源文件不存在或不可读'
          : '文件快照不可用');
    }).catch((reason: unknown) => {
      if (active) setError(statusError(reason));
    });
    return () => {
      active = false;
      abortRef.current?.abort();
      imageAbortRef.current?.abort();
    };
  }, [attempt, request, target.hostId, target.itemId, target.linkIndex, target.threadId, android]);

  const ActionIcon = android ? Download : Copy;
  const actionLabel = android ? (progress === null ? '保存到系统' : '保存中 · ' + progress + '%') :
    '复制私有链接';
  return <section className="publication-preview-page" role="dialog" aria-modal="true"
    aria-labelledby="publication-preview-title">
    <header>
      <button type="button" className="publication-back" autoFocus onClick={onClose}>
        <ArrowLeft size={18}/>返回对话
      </button>
      <div className="publication-preview-heading">
        <h2 id="publication-preview-title">{file?.name ?? localFileName(target.path)}</h2>
        {file && <span>{new Intl.NumberFormat('zh-CN').format(file.size)} 字节 ·
          有效至 {new Date(file.expiresAt).toLocaleString('zh-CN')}</span>}
      </div>
      <button type="button" className="publication-local-action" disabled={!file || busy}
        onClick={() => { if (file) void localAction(file); }}>
        <ActionIcon size={17}/>{actionLabel}
      </button>
    </header>
    {error && <div className="publication-preview-state publication-preview-error" role="alert">
      <span>{error}</span>
      {!file && <button type="button" disabled={busy}
        onClick={() => setAttempt((value) => value + 1)}><RotateCw size={16}/>重试</button>}
    </div>}
    {localStatus && <div className="publication-preview-state" role="status">{localStatus}</div>}
    <div className="publication-preview-content">
      {!file && !error ? <div className="publication-preview-state" role="status">
        <span className="activity-spinner"/>正在核实消息引用并准备单文件快照
      </div> : file ? <PreviewContent file={file} hostId={target.hostId}
        onSaveImage={() => void saveImage(file)} imageBusy={imageBusy}
        imageProgress={imageProgress}/> : null}
    </div>
  </section>;
}
