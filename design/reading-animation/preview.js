const labels = ['静静读书', '抬起爪子', '碰到页角', '掀起书页', '翻过书脊', '书页落下', '收回爪子', '继续阅读']
const durations = [1800, 180, 180, 180, 180, 180, 180, 300]
const cycle = durations.reduce((sum, value) => sum + value, 0)
const starts = durations.map((_, i) => durations.slice(0, i).reduce((sum, value) => sum + value, 0))
const byId = (id) => document.getElementById(id)
const stage = document.querySelector('.stage')
const frameControl = byId('frame')
const motion = matchMedia('(prefers-reduced-motion: reduce)')
let current = 0, elapsed = 0, lastTime = null, request = 0, playing = false, ready = false

function showFrame(frame) {
  current = frame
  stage.style.setProperty('--frame-x', `${frame % 4 * 100 / 3}%`)
  stage.style.setProperty('--frame-y', frame < 4 ? '0%' : '100%')
  frameControl.value = String(frame)
  frameControl.setAttribute('aria-valuetext', `${frame + 1} / 8，${labels[frame]}`)
  byId('frame-label').value = `${frame + 1} / 8 · ${labels[frame]}`
}
function tick(time) {
  if (!playing || document.hidden) { lastTime = null; return }
  if (lastTime !== null) elapsed = (elapsed + Math.min(time - lastTime, 100) * Number(byId('speed').value)) % cycle
  lastTime = time
  let frame = 7
  while (frame > 0 && elapsed < starts[frame]) frame--
  if (frame !== current) showFrame(frame)
  request = requestAnimationFrame(tick)
}
function setPlaying(value) {
  if (!ready) return
  playing = value
  cancelAnimationFrame(request)
  lastTime = null
  byId('play').textContent = playing ? '暂停' : '播放'
  byId('play').setAttribute('aria-pressed', String(playing))
  byId('status').textContent = playing ? '循环播放中 · 阅读停留后，翻过一页。' : '已暂停 · 拖动进度条或用左右键逐帧查看。'
  if (playing && !document.hidden) request = requestAnimationFrame(tick)
}
function scrub(frame) {
  setPlaying(false)
  showFrame((frame + 8) % 8)
  elapsed = starts[current]
}
byId('play').addEventListener('click', () => setPlaying(!playing))
byId('restart').addEventListener('click', () => { elapsed = 0; showFrame(0); setPlaying(true) })
byId('previous').addEventListener('click', () => scrub(current - 1))
byId('next').addEventListener('click', () => scrub(current + 1))
frameControl.addEventListener('input', () => scrub(Number(frameControl.value)))
byId('background').addEventListener('change', (event) => { stage.dataset.background = event.target.value })
byId('size').addEventListener('change', (event) => { stage.style.setProperty('--sprite-size', `${event.target.value}px`) })
document.addEventListener('keydown', (event) => {
  if (!ready || /INPUT|SELECT|BUTTON|A/.test(event.target.tagName)) return
  if (event.code === 'Space') { event.preventDefault(); setPlaying(!playing) }
  if (event.code === 'ArrowLeft') { event.preventDefault(); scrub(current - 1) }
  if (event.code === 'ArrowRight') { event.preventDefault(); scrub(current + 1) }
})
document.addEventListener('visibilitychange', () => {
  cancelAnimationFrame(request); lastTime = null
  if (!document.hidden && playing) request = requestAnimationFrame(tick)
})
motion.addEventListener('change', () => { if (motion.matches) setPlaying(false) })
showFrame(0)
Promise.all(['golden-turn.png', 'tuxedo-turn.png'].map((file) => {
  const image = new Image()
  image.src = new URL(file, import.meta.url).href
  return image.decode()
})).then(() => {
  ready = true
  document.querySelectorAll('button, input').forEach((element) => { element.disabled = false })
  setPlaying(!motion.matches)
}).catch(() => {
  byId('play').textContent = '加载失败'
  byId('status').textContent = '动画图片未能加载，请刷新页面重试。'
})
