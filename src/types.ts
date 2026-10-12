export interface LessonItem {
  id: string
  nativeText: string
  text: string
  ruby: RubyPart[]
  level?: string
  sourceWord?: string
  sourceNoteId?: string
}

export interface RubyPart {
  text: string
  reading?: string
}

export type TargetLanguage = 'ja' | 'en'

export interface Lesson {
  schemaVersion: 2
  id: string
  title: string
  nativeLanguage: 'zh-CN'
  targetLanguage: TargetLanguage
  items: LessonItem[]
  metadata?: DeckMetadata
}

export interface DeckMetadata {
  description: string
  author?: string
  version?: string
  sourceUrl?: string
  license?: string
  licenseUrl?: string
  licenseTerms?: string[]
  modifications?: string
  sourceFile?: string
  noteCount: number
  cardCount: number
  relatedCount: number
  duplicateCount: number
  missingCount: number
  unalignedReadingCount: number
  builtIn?: boolean
}

export interface HistoryEntry {
  id: string
  completedAt: string
  lessonId: string
  lessonTitle?: string
  sentenceCount: number
  elapsedMs: number
  mode?: 'memory' | 'free'
  partial?: boolean
}

export interface PracticeSummary {
  elapsedMs: number
  sentenceCount: number
}
