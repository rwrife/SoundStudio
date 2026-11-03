import { AlertTriangle, Check, Download, LoaderCircle } from 'lucide-react'
import { formatBytes, totalBytes, type ModelDownload } from '../shared/modelDownloads'
import type { Backend } from './useBackend'

/** Download button, progress and outcome for the models a workspace still needs. The main process asks for confirmation. */
export function ModelDownloadPanel({ backend, items }: { backend: Backend; items: ModelDownload[] }) {
  const { download, downloadError } = backend
  const unique = [...new Map(items.map(item => [item.id, item])).values()]
  const downloading = download.phase === 'downloading'
  const percent = download.total ? Math.floor(download.received / download.total * 100) : 0

  if (!downloading && !unique.length && download.phase === 'idle' && !downloadError) return null
  return <div className="download-panel">
    {downloading ? <>
      <div className="download-heading"><LoaderCircle size={15} className="spin" /><strong>Downloading {download.current}</strong>
        <button className="text-button" onClick={() => void backend.cancelDownload()}>Cancel</button></div>
      <div className="progress" role="progressbar" aria-label="Model download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
      <p className="field-hint">{formatBytes(download.received)} of {formatBytes(download.total)} ({percent}%). You can keep working; generation is ready when it finishes.</p>
    </> : unique.length ? <>
      <button className="primary full" onClick={() => void backend.downloadModels(unique)}><Download size={15} /> Download {unique.length === 1 ? unique[0].label : 'models'} ({formatBytes(totalBytes(unique))})</button>
      <p className="field-hint">{unique.length > 1 ? `${unique.map(item => item.label).join(', ')}. ` : ''}Saved to your ComfyUI from Hugging Face and verified. You confirm first.</p>
    </> : null}
    {downloadError ? <p className="warning-text" role="alert"><AlertTriangle size={14} /> {downloadError}</p>
      : (download.phase === 'failed' || download.phase === 'cancelled') ? <p className="warning-text" role="alert"><AlertTriangle size={14} /> {download.message}</p>
      : download.phase === 'completed' && !unique.length ? <p className="success-text" role="status"><Check size={14} /> {download.message}</p> : null}
  </div>
}
