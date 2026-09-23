# 日语敲敲设计

已选用大金毛「麦麦」与黑白猫「点点」。最初角色稿分别为 golden-retriever-concept.png 和 tuxedo-cat-concept.png。网站采用 src/assets/companions/ 下清理过背景的透明素材，从左到右为待机、打字、庆祝，仅切换姿态，不做整图摇晃。

早期十个候选方案见 animal-concepts.md，仅作设计存档。

侧边待机仅保留阅读，素材为 src/assets/companions/golden-reading.png 与 tuxedo-reading.png。每张四个等宽格，对应 src/lib/pet-books.ts 中的四本书，书名直接绘在封面上。换书会切换封面图；翻页切换原创短句，支持手动操作与每六秒自动翻页。页面后台、关闭自动翻页或减少动态效果时暂停计时。当前不包含连续的爪子翻页动画，后续需制作逐帧素材或分层骨骼动画。阅读不产生学习记录或成长奖励。

图标草案仍为「小木槌敲键帽」，见 branding/mallet-icon.svg，尚未替换网站图标。
