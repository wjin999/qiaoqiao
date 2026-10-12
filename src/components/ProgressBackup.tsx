import { useRef, useState } from 'react'
import { MAX_BACKUP_BYTES, restoreProgress, serializeProgress, type ProgressData } from '../lib/progress-backup'
import { exportProgress } from '../lib/storage'

interface Props {
  onRestore: (progress: ProgressData) => void
}

export function ProgressBackup({ onRestore }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function download() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const source = serializeProgress(await exportProgress())
      const blob = new Blob([source], { type: 'application/json;charset=utf-8' })
      if (blob.size > MAX_BACKUP_BYTES) throw new Error('完整进度超过 256 MB 的单文件备份上限，原有记录仍保留在浏览器中。')
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `typelingo-progress-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
      setMessage('已请求下载进度备份，请在浏览器的下载记录或“文件”中保存 JSON 文件。')
    } catch (error) { setError(error instanceof Error ? error.message : '导出失败，请重试。') }
    finally { setBusy(false) }
  }

  async function restore(file?: File) {
    if (!file) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('进度文件超过 256 MB 的单文件恢复上限。')
      const progress = await restoreProgress(await file.text())
      onRestore(progress)
      setMessage(`进度已合并：${progress.history.length} 轮成绩、${progress.reviews.length} 条逐句记录、${progress.cards.length} 份复习计划。`)
    } catch (error) { setError(error instanceof Error ? error.message : '恢复失败，请检查备份文件。') }
    finally { setBusy(false) }
  }

  return <div className="progress-backup">
    <div className="backup-actions">
      <button className="text-button" type="button" disabled={busy} onClick={download}>导出进度</button>
      <button className="text-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? '正在处理…' : '恢复进度'}</button>
      <input ref={inputRef} type="file" accept=".json,application/json" hidden aria-label="选择进度备份文件" onChange={(event) => {
        void restore(event.target.files?.[0]); event.target.value = ''
      }} />
    </div>
    <p className="backup-help">备份全部成绩、逐句记录、复习计划与永久跳过记录。恢复时合并记录，同一句保留较新的计划；兼容旧备份。</p>
    <p className="backup-help">记录长期保存在此浏览器，清除网站数据仍会丢失，请定期导出。单个备份恢复上限 256 MB。</p>
    {message && <p role="status" className="backup-status">{message}</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
  </div>
}
