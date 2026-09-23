# 生成记录

工具：内置 imagegen。参考：src/assets/companions/golden-reading.png、tuxedo-reading.png。

## 连续画面生成

Create a production 8-frame sequential sprite animation sheet of the FIRST animal/book in this reference, reading and turning one page. Reference input is character/style identity only, not the four-book layout. Output layout EXACTLY 4 columns x 2 rows, 8 equal cells, read left-to-right top row then bottom row. Genuine transparent RGBA background, no floor, shadow, white matte, labels, frame numbers, captions or gutters drawn. Every cell has exactly one COMPLETE full-body pet with identical scale, camera, body silhouette, head position, tail, feet, book cover and title. All cell-relative anchors must align perfectly: feet baseline at 90% cell height, head at 8%, book spine center x50% at y55%. Keep 8% safe padding so no animal crosses a cell boundary. This is NOT a set of different poses: body, head, feet, tail and book cover remain pixel-consistent, only ONE forepaw and ONE thin cream book page move with a coherent motion arc. Exactly four limbs total, two hind feet + two forepaws; one forepaw supports the book throughout, the other forepaw leaves its grip to turn the page, never duplicate it. No human hands. Keep the green book title painted on its front cover unchanged and legible in every frame.
Frame 1: restful reading, both forepaws on book's outer edges.
Frame 2: viewer-right forepaw lifts slightly upward from edge, preparing to turn.
Frame 3: that same forepaw reaches the top right paper corner, page begins to curl.
Frame 4: forepaw lifts ONE cream page, bending across top of book at about 45 degrees, page narrower as it tilts.
Frame 5: page upright over center spine at about 90 degrees, forepaw follows to center, page appears almost edge-on.
Frame 6: page falls onto left stack at about 150 degrees, forepaw follows leftward.
Frame 7: page fully settled on left, forepaw withdrawing toward its original right edge position.
Frame 8: forepaw fully back to grip, exact same image as frame 1 for seamless loop.
Subtle beautiful storybook illustration matching reference, natural lean cute pet, consistent clean edges, NO whole body sway, NO changes in head size or expression. The purpose is to play these 8 consecutive images as one continuous action.

Golden: golden retriever 麦麦. Exact green cover title: 如何赢得狗狗朋友.

Tuxedo: black-white tuxedo cat 点点. Exact green cover title: 高效猫猫的七个习惯.

## 背景修订

undefined

Golden extra instruction: Additionally in frame 4 (top right cell), draw the lifted thin cream page at a diagonal 45 degree angle from the center spine toward viewer-right, with existing raised paw touching its upper corner. This is the missing in-between before frame 5's vertical page. Keep the same paw, do not add another.
