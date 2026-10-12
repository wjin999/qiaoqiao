import type { TargetLanguage } from './types'

export const LANGUAGE_ORDER: TargetLanguage[] = ['ja', 'en']

// Page copy for each target language. The practice layout is shared:
// Chinese on top, the sentence to type in the middle, the input below.
export const LANGUAGES: Record<TargetLanguage, {
  name: string
  title: string
  intro: [string, string]
  memoryHint: string
  freeHint: string
  typingHelp: string
  typingHelpMobile: string
  ratingHelp: string
  ratingHelpMobile: string
  example: { text: string; translation: string }
  loading: string
}> = {
  ja: {
    name: '日语',
    title: '打字，记住日语。',
    intro: ['以假名输入联结汉字、读音与语义，沿助词与句型梳理表达结构。', '让每次敲击，都成为有语境的日语练习。'],
    memoryHint: '先回忆读音，再跟打核对。完成后按 1–4 评分，安排下次复习。',
    freeHint: '随机选句，默认显示注音；完成后按 Enter 继续，不改变记忆复习计划。',
    typingHelp: '请使用日语输入法；Backspace 修正，Tab 切换注音，Shift+Tab 移动焦点。',
    typingHelpMobile: '使用日语输入法，',
    ratingHelp: '按看注音前的回忆评分：想不起来选「重来」，费力但想起来选「困难」。',
    ratingHelpMobile: '按看注音前的回忆，选择评分',
    example: { text: '天気がいいから、散歩しましょう', translation: '天气很好，我们去散步吧' },
    loading: '正在加载 egg rolls 例句库…',
  },
  en: {
    name: '英语',
    title: '打字，记住英语。',
    intro: ['看着中文，逐字敲出完整英文句子，把拼写、词序与语义连在一起。', '让每次敲击，都成为有语境的英语练习。'],
    memoryHint: '跟打整句英文，完成后按 1–4 评分，安排下次复习。',
    freeHint: '随机选句；完成后按 Enter 继续，不改变记忆复习计划。',
    typingHelp: '直接输入英文，大小写和标点需与原句一致；Backspace 修正。',
    typingHelpMobile: '输入英文，',
    ratingHelp: '按这句的熟练程度评分：打得很吃力选「重来」，有些吃力选「困难」。',
    ratingHelpMobile: '按熟练程度，选择评分',
    example: { text: "The weather is nice, so let's take a walk.", translation: '天气很好，我们去散步吧' },
    loading: '正在加载英文例句…',
  },
}
