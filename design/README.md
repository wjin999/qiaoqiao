# 日语敲敲设计

已选用大金毛「麦麦」与黑白猫「点点」。角色稿分别为 golden-retriever-concept.png 和 tuxedo-cat-concept.png，每张从左到右为待机、打字、庆祝。网站素材放在 src/assets/companions/，用 CSS 切换姿态与播放小动作。

早期十个候选方案见 animal-concepts.md，仅作设计存档。

侧边活动素材为 src/assets/companions/golden-activities.png 与 tuxedo-activities.png，使用原角色稿生成，三个姿态分别为读书、哑铃下放、哑铃举起。翻页和锻炼由 CSS 动画实现；书名改编与页内原创短句在 src/lib/pet-books.ts。非选中伙伴的活动不产生学习记录或成长奖励。

图标草案仍为「小木槌敲键帽」，见 branding/mallet-icon.svg，尚未替换网站图标。
