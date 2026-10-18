// ホームの背景に、墨流しのような細い線の流れを描く。
// 線はゆっくり形を変える流れに乗って漂い、マウスカーソルの周りでは渦を巻いて道を空け、動かした向きへ引きずられる。
// カーソルの近くを通った線は真鍮色に光り、離れると元の色へ戻る。
// 飾りなので、動きを減らす設定では描かず、canvas を使えない環境では何もしない。
// 止めたことは localStorage の toolbox-flow に 'off' で残し、版をまたいで引き継ぐ（旧 toolbox と同じキー）。
// 見ていないときは休む。操作がないまま時間が過ぎるか、ウィンドウが前面から外れるか、ツールを開いている間は描画を止める。
import { storedSignal } from '../lib/storage';

export const FLOW_KEY = 'toolbox-flow';

/** 背景の流れを動かすか。止めたら 'off' を残し、動かしたら記録を消す。 */
export const flowEnabled = storedSignal(
  FLOW_KEY,
  (text) => text !== 'off',
  (on) => (on ? null : 'off'),
);

// 1本の線が覚えている位置の数。古い位置ほど薄く描き、尾を引かせる。
const TRAIL = 30;
// 透明度の段階。同じ段階の線をまとめて1回で描き、描画の回数を抑える。
const LEVELS = 6;
// カーソルの渦が届く半径（CSS ピクセル）。
const RADIUS = 180;
// 操作がないまま、この時間が過ぎたら流れを静める（ミリ秒）。
const IDLE_MS = 8000;
// 描き直しの最短間隔。120Hz などの画面でも毎秒60回までにする。60Hz の揺らぎで間引かないよう少し短くする。
const FRAME_MS = 1000 / 60 - 2;

export interface Flow {
  /** ボタンの状態・動きを減らす設定・ホームが見えているかを合わせた、動かすかどうか。 */
  set(running: boolean): void;
  dispose(): void;
}

/**
 * canvas は画面全体に敷いた背景。文字色に --tb-accent、outline-color に --tb-gold を指定しておくと、
 * その計算済みの色（ライト・ダーク）で線を描く。
 */
export function createFlow(canvas: HTMLCanvasElement): Flow | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const win = window;
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const events = new AbortController();
  const on = <K extends keyof WindowEventMap>(
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options: AddEventListenerOptions = {},
  ) => win.addEventListener(type, listener, { ...options, signal: events.signal });

  let width = 0;
  let height = 0;
  let count = 0;
  // 各線の位置・速さ・残りの寿命・寿命・光り具合と、位置の履歴（全員が毎フレーム同じ位置に書く輪）。
  let pos = new Float32Array(0);
  let vel = new Float32Array(0);
  let life = new Float32Array(0);
  let span = new Float32Array(0);
  let heat = new Float32Array(0);
  let trail = new Float32Array(0);
  let head = 0;
  // 履歴は 1/60 秒ごとに記録し、画面の書き換えの速さが違っても尾の長さを揃える。
  let sinceRecord = 0;
  let time = Math.random() * 10000;
  let last = 0;
  let frameId = 0;
  let haltTimer = 0;
  let running = false;
  // 流れの速さの倍率。静めるときは 0 へ近づけ、線をその場に残して止める。
  let pace = 1;
  let lastActive = 0;
  let focused = document.hasFocus();
  let ink = '';
  let glow = '';
  let dark = false;
  let sized = false;

  // 前のフレームからの移動量を足し込み、フレームごとに滑らかな速さへならす。
  const pointer = { x: 0, y: 0, dx: 0, dy: 0, vx: 0, vy: 0, energy: 0, inside: false };

  function readColors() {
    const style = getComputedStyle(canvas);
    ink = style.color;
    glow = style.outlineColor;
    dark = (root.dataset.tbTheme ?? (system.matches ? 'dark' : 'light')) === 'dark';
    // 静めて止めている間も、残した線の色を変える。
    if (count && running && !frameId) draw();
  }

  function spawn(i: number, fresh: boolean) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    pos[i * 2] = x;
    pos[i * 2 + 1] = y;
    vel[i * 2] = 0;
    vel[i * 2 + 1] = 0;
    span[i] = 260 + Math.random() * 420;
    // 開いた直後に全員が同時に入れ替わらないよう、最初は寿命の途中から始める。
    life[i] = fresh ? Math.random() * span[i]! : span[i]!;
    heat[i] = 0;
    for (let k = 0; k < TRAIL; k++) {
      trail[(i * TRAIL + k) * 2] = x;
      trail[(i * TRAIL + k) * 2 + 1] = y;
    }
  }

  function resize() {
    // 高解像度の画面でも等倍で描く。細く淡い線なので見た目はほぼ変わらず、塗る画素数が減る。
    const dpr = Math.min(win.devicePixelRatio || 1, 1);
    width = win.innerWidth;
    height = win.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 広い画面ほど線を増やすが、密になりすぎないよう上限を置く。
    count = Math.round(Math.min(620, Math.max(120, (width * height) / 2100)));
    pos = new Float32Array(count * 2);
    vel = new Float32Array(count * 2);
    life = new Float32Array(count);
    span = new Float32Array(count);
    heat = new Float32Array(count);
    trail = new Float32Array(count * TRAIL * 2);
    for (let i = 0; i < count; i++) spawn(i, true);
    sized = true;
  }

  // 流れの元になる関数。いくつかの波を重ね、座標を少し歪ませて規則的な縞を崩す。
  // この関数の回転（curl）を速さにするため、流れは湧き出しも吸い込みもなく、水のように渦を巻く。
  function potential(x: number, y: number) {
    const wx = x + 80 * Math.sin(y * 0.0043 + time * 0.0031);
    const wy = y + 80 * Math.sin(x * 0.0037 - time * 0.0027);
    return (
      140 * Math.sin(wx * 0.0061 + wy * 0.0024 + time * 0.0042) +
      105 * Math.sin(wy * 0.0077 - wx * 0.0032 - time * 0.0051 + 1.7) +
      42 * Math.sin((wx + wy) * 0.0131 + time * 0.0067 + 4.1)
    );
  }

  // カーソルの速さと渦の強さは、流れを静めている間も実際の時間（elapsed）で進める。
  function updatePointer(elapsed: number) {
    const p = pointer;
    const ease = 1 - Math.pow(0.7, elapsed);
    p.vx += (p.dx / elapsed - p.vx) * ease;
    p.vy += (p.dy / elapsed - p.vy) * ease;
    p.dx = 0;
    p.dy = 0;
    // 動かすほど渦が強まり、止めると静かな渦に、画面の外へ出ると消える。
    const target = p.inside ? Math.min(1.6, 0.45 + Math.hypot(p.vx, p.vy) / 14) : 0;
    p.energy += (target - p.energy) * (1 - Math.pow(target > p.energy ? 0.85 : 0.97, elapsed));
  }

  function update(step: number) {
    time += step;
    const p = pointer;
    const r2 = RADIUS * RADIUS;
    const eye2 = (RADIUS * 0.4) ** 2;
    const swirl = 2.4 * p.energy;
    const follow = 1 - Math.pow(0.9, step);
    const cool = Math.pow(0.965, step);
    const margin = 40;
    for (let i = 0; i < count; i++) {
      const x = pos[i * 2]!;
      const y = pos[i * 2 + 1]!;
      let u = (potential(x, y + 1) - potential(x, y - 1)) / 2;
      let v = (potential(x - 1, y) - potential(x + 1, y)) / 2;
      let near = 0;
      if (p.energy > 0.01) {
        const dx = x - p.x;
        const dy = y - p.y;
        const d2 = dx * dx + dy * dy;
        near = Math.exp(-d2 / r2);
        // 釣り鐘形の関数の回転で、カーソルを中心に回る渦を足す。
        const k = (2 * swirl * near) / RADIUS;
        u -= k * dy;
        v += k * dx;
        // 中心は石を置いたように少し押しのけ、動かした向きへは引きずる。
        const d = Math.sqrt(d2) || 1;
        const push = 0.6 * p.energy * Math.exp(-d2 / eye2);
        u += (dx / d) * push + p.vx * near * 0.55;
        v += (dy / d) * push + p.vy * near * 0.55;
      }
      vel[i * 2] = vel[i * 2]! + (u - vel[i * 2]!) * follow;
      vel[i * 2 + 1] = vel[i * 2 + 1]! + (v - vel[i * 2 + 1]!) * follow;
      const nx = x + vel[i * 2]! * step;
      const ny = y + vel[i * 2 + 1]! * step;
      heat[i] = Math.max(heat[i]! * cool, near * Math.min(1, p.energy));
      life[i] = life[i]! - step;
      if (
        life[i]! <= 0 ||
        nx < -margin ||
        ny < -margin ||
        nx > width + margin ||
        ny > height + margin
      ) {
        spawn(i, false);
      } else {
        pos[i * 2] = nx;
        pos[i * 2 + 1] = ny;
      }
    }
    sinceRecord += step;
    if (sinceRecord < 1) return;
    sinceRecord %= 1;
    head = (head + 1) % TRAIL;
    for (let i = 0; i < count; i++) {
      trail[(i * TRAIL + head) * 2] = pos[i * 2]!;
      trail[(i * TRAIL + head) * 2 + 1] = pos[i * 2 + 1]!;
    }
  }

  function draw() {
    const c = ctx!;
    c.clearRect(0, 0, width, height);
    const p = pointer;
    if (p.energy > 0.01) {
      // カーソルの下に、真鍮色の淡い明かりを置く。
      const light = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, RADIUS * 1.4);
      light.addColorStop(0, glow);
      light.addColorStop(1, 'transparent');
      c.globalAlpha = (dark ? 0.08 : 0.06) * Math.min(1, p.energy);
      c.fillStyle = light;
      c.fillRect(p.x - RADIUS * 1.4, p.y - RADIUS * 1.4, RADIUS * 2.8, RADIUS * 2.8);
    }
    // 前半 LEVELS 個は地の線、後半は光る線。
    const paths = Array.from({ length: LEVELS * 2 }, () => new Path2D());
    for (let i = 0; i < count; i++) {
      // 生まれた直後と消える前は薄くし、急に現れたり消えたりしないようにする。
      const fade = Math.min(1, life[i]! / 45, (span[i]! - life[i]!) / 45);
      const hot = heat[i]! > 0.12;
      const strength = hot ? fade * Math.min(1, heat[i]! * 1.6) : fade;
      const base = hot ? LEVELS : 0;
      let k0 = (head + 1) % TRAIL;
      for (let s = 1; s < TRAIL; s++) {
        const k1 = (head + 1 + s) % TRAIL;
        const level = Math.ceil((s / (TRAIL - 1)) ** 0.7 * strength * LEVELS) - 1;
        if (level >= 0) {
          const path = paths[base + level]!;
          const a = (i * TRAIL + k0) * 2;
          const b = (i * TRAIL + k1) * 2;
          path.moveTo(trail[a]!, trail[a + 1]!);
          path.lineTo(trail[b]!, trail[b + 1]!);
        }
        k0 = k1;
      }
    }
    c.lineWidth = 1;
    for (let n = 0; n < LEVELS * 2; n++) {
      const hot = n >= LEVELS;
      const level = (n % LEVELS) + 1;
      c.globalAlpha = (level / LEVELS) * (hot ? (dark ? 0.8 : 0.85) : dark ? 0.32 : 0.28);
      // 暗い地では光る線を加算で重ね、灯るように見せる。
      c.globalCompositeOperation = hot && dark ? 'lighter' : 'source-over';
      c.strokeStyle = hot ? glow : ink;
      c.stroke(paths[n]!);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  function loop(now: number) {
    if (now - last < FRAME_MS) {
      frameId = win.requestAnimationFrame(loop);
      return;
    }
    // 60fps を1として進める。タブを離れていた後などは大きく飛ばない。
    const elapsed = Math.min(Math.max((now - last) / (1000 / 60), 0.25), 3);
    last = now;
    // 操作が続く間は流し、途絶えるかウィンドウが前面から外れたら、2秒ほどかけて静める。
    const awake = focused && now - lastActive < IDLE_MS;
    pace += ((awake ? 1 : 0) - pace) * (1 - Math.pow(awake ? 0.9 : 0.96, elapsed));
    updatePointer(elapsed);
    update(elapsed * pace);
    draw();
    // 静まったら、最後の絵を残したまま描き直しをやめる。
    frameId = awake || pace > 0.01 ? win.requestAnimationFrame(loop) : 0;
  }

  function run() {
    if (frameId || !running) return;
    last = performance.now();
    frameId = win.requestAnimationFrame(loop);
  }

  // 操作があったら、静めていた流れを再び動かす。
  function wake() {
    lastActive = performance.now();
    run();
  }

  function halt() {
    win.cancelAnimationFrame(frameId);
    frameId = 0;
    ctx!.clearRect(0, 0, width, height);
  }

  on(
    'pointermove',
    (event) => {
      if (pointer.inside) {
        pointer.dx += event.clientX - pointer.x;
        pointer.dy += event.clientY - pointer.y;
      }
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.inside = true;
      wake();
    },
    { passive: true },
  );
  for (const type of ['pointerdown', 'keydown', 'wheel'] as const)
    on(type, wake, { passive: true });
  document.addEventListener(
    'pointerout',
    (event) => {
      if (!event.relatedTarget) pointer.inside = false;
    },
    { signal: events.signal },
  );
  on('blur', () => {
    focused = false;
    pointer.inside = false;
  });
  on('focus', () => {
    focused = true;
    wake();
  });
  on('resize', () => {
    if (!running) {
      sized = false;
      return;
    }
    resize();
    wake();
  });
  // 切り替えボタン（data-tb-theme）と OS の設定のどちらで配色が変わっても、線の色を合わせる。
  system.addEventListener('change', readColors, { signal: events.signal });
  const observer = new MutationObserver(readColors);
  observer.observe(root, { attributeFilter: ['data-tb-theme'] });

  return {
    set(next) {
      if (next === running) return;
      running = next;
      win.clearTimeout(haltTimer);
      if (running) {
        if (!sized) resize();
        readColors();
        // 開いたときは CSS でゆっくり浮かび上がらせる。
        canvas.dataset.running = '';
        lastActive = performance.now();
        run();
      } else {
        // 止めるときは、CSS で薄くし終わるまで今の線を残す（流れている間は流したまま）。
        delete canvas.dataset.running;
        haltTimer = win.setTimeout(halt, 700);
      }
    },
    dispose() {
      events.abort();
      observer.disconnect();
      halt();
    },
  };
}
