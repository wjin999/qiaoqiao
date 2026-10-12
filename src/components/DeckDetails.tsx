import type { Lesson } from '../types'
import { Modal } from './Modal'

function safeLink(value?: string): string | undefined {
  if (!value) return undefined
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined } catch { return undefined }
}

export function DeckDetails({ lesson, onClose }: { lesson: Lesson; onClose: () => void }) {
  const metadata = lesson.metadata
  const source = safeLink(metadata?.sourceUrl)
  const licenseUrl = safeLink(metadata?.licenseUrl)
  const readings = lesson.items.filter((item) => item.ruby.some((part) => part.reading)).length
  return (
    <Modal title="卡组详情" onClose={onClose}>
      <span className="eyebrow">{metadata?.builtIn ? '默认卡组' : '我的导入'}</span>
      <h3 className="deck-detail-title">{lesson.title}</h3>
      <p className="detail-description">{metadata?.description || '日语跟打练习卡组。'}</p>
      <dl className="deck-stats">
        <div><dt>可练习例句 / 短语</dt><dd>{lesson.items.length.toLocaleString('zh-CN')}</dd></div>
        <div><dt>附有假名注音</dt><dd>{readings.toLocaleString('zh-CN')}</dd></div>
        <div><dt>原卡组词条</dt><dd>{metadata?.noteCount.toLocaleString('zh-CN') ?? '—'}</dd></div>
        <div><dt>原卡组卡片</dt><dd>{metadata?.cardCount.toLocaleString('zh-CN') ?? '—'}</dd></div>
      </dl>
      <div className="level-breakdown">
        {['N5', 'N4', 'N3', 'N2', 'N1'].map((level) => {
          const count = lesson.items.filter((item) => item.level === level).length
          return count > 0 && <span key={level}>{level}<strong>{count.toLocaleString('zh-CN')}</strong></span>
        })}
      </div>
      <dl className="detail-facts">
        <div><dt>作者</dt><dd>{metadata?.author || '卡组未提供'}</dd></div>
        {metadata?.version && <div><dt>版本</dt><dd>{metadata.version}</dd></div>}
        {metadata?.sourceFile && <div><dt>来源文件</dt><dd>{metadata.sourceFile}</dd></div>}
        {source && <div><dt>原卡组发布页</dt><dd><a href={source} target="_blank" rel="noreferrer">{source}</a></dd></div>}
      </dl>
      <section className="license-panel" aria-label="卡组许可">
        <h3>许可与署名</h3>
        <p>{metadata?.author && <>本卡组由 <strong>{metadata.author}</strong> 制作。 </>}
          {licenseUrl ? <a href={licenseUrl} target="_blank" rel="noreferrer">{metadata?.license}</a> : metadata?.license || '原文件未提供可识别的许可信息。'}
        </p>
        {metadata?.licenseTerms && <ol>{metadata.licenseTerms.map((term) => <li key={term}>{term}</li>)}</ol>}
      </section>
      {metadata?.modifications && <section className="conversion-note">
        <h3>本练习库的整理说明</h3>
        <p>{metadata.modifications.replaceAll('TypeLingo', '日语敲敲')}</p>
        <p>排除关联词 / 反义词 {metadata.relatedCount.toLocaleString('zh-CN')} 条；去重 {metadata.duplicateCount} 条；缺少有效句对 {metadata.missingCount} 条。</p>
        {metadata.unalignedReadingCount > 0 && <p>{metadata.unalignedReadingCount} 条注音与原句无法完全对齐，保留原句并显示为无注音。</p>}
      </section>}
    </Modal>
  )
}
