type GameState = 'start' | 'playing' | 'game_over';

type Bubble = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
};

type ObstacleKind = 'bird' | 'plane' | 'satellite' | 'junk';

type Obstacle = {
  id: number;
  kind: ObstacleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  w?: number;
  h?: number;
  angle?: number;
  spin?: number;
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function circleCircle(a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rr = a.r + b.r;
  return dx * dx + dy * dy <= rr * rr;
}

function circleRect(
  c: { x: number; y: number; r: number },
  r: { x: number; y: number; w: number; h: number }
): boolean {
  const cx = clamp(c.x, r.x - r.w / 2, r.x + r.w / 2);
  const cy = clamp(c.y, r.y - r.h / 2, r.y + r.h / 2);
  const dx = c.x - cx;
  const dy = c.y - cy;
  return dx * dx + dy * dy <= c.r * c.r;
}

function pathRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private state: GameState = 'start';

  private cssW = 0;
  private cssH = 0;
  private dpr = 1;

  private bubble: Bubble = { x: 0, y: 0, vx: 0, vy: 0, r: 18 };

  private cameraBottomY = 0;

  private pointerX: number | null = null;
  private pointerDown = false;

  private obstacles: Obstacle[] = [];
  private nextObstacleId = 1;
  private spawnT = 0;

  private maxHeightM = 0;
  private bestHeightM = 0;
  private lastFrameMs: number | null = null;
  private rafId: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx = ctx;

    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.frame = this.frame.bind(this);
  }

  start(): void {
    this.handleResize();

    window.addEventListener('resize', this.handleResize);

    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerUp);
    this.canvas.addEventListener('pointerleave', this.handlePointerUp);

    this.canvas.style.cursor = 'crosshair';

    this.bestHeightM = this.loadBestHeightM();
    this.resetToStart();
    this.rafId = requestAnimationFrame(this.frame);
  }

  private resetToStart(): void {
    this.state = 'start';
    this.bubble = { x: 0, y: 0, vx: 0, vy: 0, r: 18 };
    this.cameraBottomY = -this.cssH * 0.05;
    this.obstacles = [];
    this.spawnT = 0;
    this.maxHeightM = 0;
    this.lastFrameMs = null;
  }

  private restartPlaying(): void {
    this.state = 'playing';
    this.bubble = { x: 0, y: 0, vx: 0, vy: 220, r: 18 };
    this.cameraBottomY = -this.cssH * 0.05;
    this.obstacles = [];
    this.spawnT = 0;
    this.maxHeightM = 0;
  }

  private loadBestHeightM(): number {
    try {
      const raw = localStorage.getItem('bestHeightM');
      if (!raw) return 0;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    } catch {
      return 0;
    }
  }

  private saveBestHeightM(v: number): void {
    try {
      localStorage.setItem('bestHeightM', String(Math.floor(v)));
    } catch {
      // ignore
    }
  }

  private getHeightM(): number {
    return Math.max(0, this.bubble.y / 10);
  }

  private zoneForHeight(heightM: number): 'sky' | 'air' | 'space' {
    if (heightM < 1000) return 'sky';
    if (heightM < 10000) return 'air';
    return 'space';
  }

  private boost(): void {
    if (this.state === 'start') {
      this.restartPlaying();
      return;
    }
    if (this.state === 'game_over') {
      this.restartPlaying();
      return;
    }

    const boostImpulse = 260;
    this.bubble.vy = clamp(this.bubble.vy + boostImpulse, -600, 900);
  }

  private handlePointerMove(ev: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    this.pointerX = clamp(x, 0, rect.width);
  }

  private handlePointerDown(ev: PointerEvent): void {
    this.pointerDown = true;
    try {
      this.canvas.setPointerCapture(ev.pointerId);
    } catch {
      // ignore
    }
    this.handlePointerMove(ev);
    this.boost();
  }

  private handlePointerUp(): void {
    this.pointerDown = false;
  }

  private handleResize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, Math.floor(rect.width));
    this.cssH = Math.max(1, Math.floor(rect.height));

    this.dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    this.canvas.width = this.cssW * this.dpr;
    this.canvas.height = this.cssH * this.dpr;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private frame(tsMs: number): void {
    const prev = this.lastFrameMs;
    this.lastFrameMs = tsMs;

    const dt = prev === null ? 0 : clamp((tsMs - prev) / 1000, 0, 0.033);

    if (this.state === 'playing') {
      this.update(dt);
    }

    this.render();

    this.rafId = requestAnimationFrame(this.frame);
  }

  private update(dt: number): void {
    const g = 780;

    const targetX = this.pointerX === null ? this.cssW / 2 : this.pointerX;
    const targetWorldX = targetX - this.cssW / 2;

    const maxX = this.cssW * 0.5 - 26;
    const followStrength = 18;
    const desiredVx = (targetWorldX - this.bubble.x) * followStrength;
    const maxVx = 520;

    this.bubble.vx = clamp(desiredVx, -maxVx, maxVx);

    this.bubble.vy -= g * dt;

    this.bubble.x = clamp(this.bubble.x + this.bubble.vx * dt, -maxX, maxX);
    this.bubble.y = Math.max(0, this.bubble.y + this.bubble.vy * dt);

    const heightM = this.getHeightM();
    this.maxHeightM = Math.max(this.maxHeightM, heightM);

    const desiredBottom = this.bubble.y - this.cssH * 0.35;
    this.cameraBottomY = Math.max(this.cameraBottomY, desiredBottom);

    this.spawnObstacles(dt, heightM);
    this.updateObstacles(dt);

    if (this.checkCollisions()) {
      if (this.maxHeightM > this.bestHeightM) {
        this.bestHeightM = this.maxHeightM;
        this.saveBestHeightM(this.bestHeightM);
      }
      this.state = 'game_over';
    }
  }

  private spawnObstacles(dt: number, heightM: number): void {
    const zone = this.zoneForHeight(heightM);

    const difficulty = clamp(heightM / 15000, 0, 1);
    const baseInterval = zone === 'sky' ? 1.15 : zone === 'air' ? 0.95 : 0.8;
    const interval = baseInterval * (1 - 0.35 * difficulty);

    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = rand(interval * 0.7, interval * 1.3);

    const topY = this.cameraBottomY + this.cssH;
    const spawnY = topY + rand(60, this.cssH * 0.55);

    const dir = Math.random() < 0.5 ? -1 : 1;
    const outX = (this.cssW / 2 + 80) * dir;

    const speedBoost = 1 + 0.8 * difficulty;

    if (zone === 'sky') {
      const r = rand(14, 20);
      const vx = -dir * rand(140, 220) * speedBoost;
      const vy = rand(-25, 25);
      this.obstacles.push({
        id: this.nextObstacleId++,
        kind: 'bird',
        x: outX,
        y: spawnY,
        vx,
        vy,
        r,
      });
      return;
    }

    if (zone === 'air') {
      const w = rand(80, 120);
      const h = rand(22, 30);
      const vx = -dir * rand(260, 360) * speedBoost;
      const vy = rand(-18, 18);
      this.obstacles.push({
        id: this.nextObstacleId++,
        kind: 'plane',
        x: outX,
        y: spawnY,
        vx,
        vy,
        r: Math.max(w, h) * 0.5,
        w,
        h,
      });
      return;
    }

    const pick = Math.random();
    if (pick < 0.45) {
      const w = rand(70, 100);
      const h = rand(26, 34);
      const vx = -dir * rand(180, 260) * speedBoost;
      const vy = rand(-22, 22);
      this.obstacles.push({
        id: this.nextObstacleId++,
        kind: 'satellite',
        x: outX,
        y: spawnY,
        vx,
        vy,
        r: Math.max(w, h) * 0.5,
        w,
        h,
      });
      return;
    }

    const r = rand(10, 22);
    const vx = -dir * rand(220, 340) * speedBoost;
    const vy = rand(-60, 60);
    this.obstacles.push({
      id: this.nextObstacleId++,
      kind: 'junk',
      x: outX,
      y: spawnY,
      vx,
      vy,
      r,
      angle: rand(0, Math.PI * 2),
      spin: rand(-2.2, 2.2),
    });
  }

  private updateObstacles(dt: number): void {
    for (const o of this.obstacles) {
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (o.spin !== undefined) {
        o.angle = (o.angle ?? 0) + o.spin * dt;
      }
    }

    const minY = this.cameraBottomY - 260;
    const maxY = this.cameraBottomY + this.cssH + 460;
    const maxX = this.cssW / 2 + 220;

    this.obstacles = this.obstacles.filter((o) => {
      if (o.y < minY) return false;
      if (o.y > maxY) return true;
      return Math.abs(o.x) < maxX;
    });
  }

  private checkCollisions(): boolean {
    const bubbleCircle = { x: this.bubble.x, y: this.bubble.y, r: this.bubble.r };

    for (const o of this.obstacles) {
      if (o.kind === 'plane' || o.kind === 'satellite') {
        const w = o.w ?? o.r * 2;
        const h = o.h ?? o.r * 2;
        if (circleRect(bubbleCircle, { x: o.x, y: o.y, w, h })) return true;
      } else {
        if (circleCircle(bubbleCircle, { x: o.x, y: o.y, r: o.r })) return true;
      }
    }

    return false;
  }

  private clear(): void {
    this.ctx.clearRect(0, 0, this.cssW, this.cssH);
  }

  private worldToScreenX(worldX: number): number {
    return this.cssW / 2 + worldX;
  }

  private worldToScreenY(worldY: number): number {
    return this.cssH - (worldY - this.cameraBottomY);
  }

  private render(): void {
    this.clear();

    const heightM = this.getHeightM();
    const zone = this.zoneForHeight(heightM);

    this.drawBackground(zone, heightM);
    this.drawObstacles();
    this.drawBubble();
    this.drawHud(heightM);

    if (this.state === 'start') {
      this.drawCenteredOverlay('BubbleGame', 'Click / tap to start\nMove pointer left/right\nClick / tap to boost');
    }

    if (this.state === 'game_over') {
      const h = Math.floor(this.maxHeightM);
      this.drawCenteredOverlay('Game Over', `You reached ${h.toLocaleString()} m\nClick / tap to restart`);
    }
  }

  private drawBackground(zone: 'sky' | 'air' | 'space', heightM: number): void {
    const ctx = this.ctx;

    if (zone === 'sky') {
      const g = ctx.createLinearGradient(0, 0, 0, this.cssH);
      g.addColorStop(0, '#6bb7ff');
      g.addColorStop(0.7, '#1f5aa8');
      g.addColorStop(1, '#0a1a33');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.cssW, this.cssH);

      const groundY = this.worldToScreenY(0);
      ctx.fillStyle = '#12310f';
      ctx.fillRect(0, groundY, this.cssW, this.cssH - groundY);
      ctx.fillStyle = '#1b4b16';
      ctx.fillRect(0, groundY - 8, this.cssW, 8);
      return;
    }

    if (zone === 'air') {
      const t = clamp((heightM - 1000) / 9000, 0, 1);
      const top = `rgb(${Math.floor(70 - 35 * t)}, ${Math.floor(120 - 55 * t)}, ${Math.floor(200 - 80 * t)})`;
      const bottom = `rgb(${Math.floor(10 - 5 * t)}, ${Math.floor(22 - 10 * t)}, ${Math.floor(45 - 15 * t)})`;

      const g = ctx.createLinearGradient(0, 0, 0, this.cssH);
      g.addColorStop(0, top);
      g.addColorStop(1, bottom);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.cssW, this.cssH);

      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 6; i++) {
        const x = (i * 140 + ((this.cameraBottomY * 0.08) % 140) + 60) % (this.cssW + 200) - 100;
        const y = 90 + i * 70;
        ctx.beginPath();
        ctx.ellipse(x, y, 90, 28, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }

    ctx.fillStyle = '#050814';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const starCount = 80;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < starCount; i++) {
      const seed = (i * 99991) % 2147483647;
      const x = ((seed * 97) % (this.cssW * 1000)) / 1000;
      const y = ((seed * 271) % (this.cssH * 1000)) / 1000;
      const tw = 0.6 + (((seed * 19) % 1000) / 1000) * 1.5;
      ctx.fillRect(x, y, tw, tw);
    }
  }

  private drawBubble(): void {
    const ctx = this.ctx;

    const sx = this.worldToScreenX(this.bubble.x);
    const sy = this.worldToScreenY(this.bubble.y);

    ctx.save();

    const rg = ctx.createRadialGradient(sx - 6, sy - 8, 2, sx, sy, this.bubble.r * 1.35);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)');
    rg.addColorStop(0.35, 'rgba(160,220,255,0.55)');
    rg.addColorStop(1, 'rgba(70,140,255,0.18)');

    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(sx, sy, this.bubble.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, this.bubble.r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx - 6, sy - 6, this.bubble.r * 0.35, -0.2, Math.PI + 0.8);
    ctx.stroke();

    ctx.restore();
  }

  private drawObstacles(): void {
    for (const o of this.obstacles) {
      const sx = this.worldToScreenX(o.x);
      const sy = this.worldToScreenY(o.y);

      if (o.kind === 'bird') {
        this.drawBird(sx, sy, o.r);
      } else if (o.kind === 'plane') {
        this.drawPlane(sx, sy, o.w ?? 100, o.h ?? 28, o.vx);
      } else if (o.kind === 'satellite') {
        this.drawSatellite(sx, sy, o.w ?? 90, o.h ?? 30, o.vx);
      } else {
        this.drawJunk(sx, sy, o.r, o.angle ?? 0);
      }
    }
  }

  private drawBird(x: number, y: number, r: number): void {
    const ctx = this.ctx;
    ctx.save();

    ctx.strokeStyle = 'rgba(20, 30, 45, 0.85)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    const flap = Math.sin(performance.now() / 140) * 0.8;

    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.quadraticCurveTo(x - r * 0.35, y - r * (0.6 + flap), x, y);
    ctx.quadraticCurveTo(x + r * 0.35, y - r * (0.6 - flap), x + r, y);
    ctx.stroke();

    ctx.restore();
  }

  private drawPlane(x: number, y: number, w: number, h: number, vx: number): void {
    const ctx = this.ctx;
    ctx.save();

    const dir = vx < 0 ? 1 : -1;
    ctx.translate(x, y);
    ctx.scale(dir, 1);

    ctx.fillStyle = 'rgba(235, 245, 255, 0.9)';
    ctx.strokeStyle = 'rgba(20, 35, 60, 0.65)';
    ctx.lineWidth = 2;

    ctx.beginPath();
    pathRoundRect(ctx, -w / 2, -h / 2, w, h, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(80, 120, 170, 0.7)';
    ctx.beginPath();
    pathRoundRect(ctx, -w * 0.1, -h * 0.95, w * 0.22, h * 0.7, 6);
    ctx.fill();

    ctx.fillStyle = 'rgba(200, 220, 245, 0.8)';
    ctx.beginPath();
    ctx.moveTo(-w * 0.05, 0);
    ctx.lineTo(w * 0.15, h * 0.9);
    ctx.lineTo(-w * 0.35, h * 0.55);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private drawSatellite(x: number, y: number, w: number, h: number, vx: number): void {
    const ctx = this.ctx;
    ctx.save();

    const dir = vx < 0 ? 1 : -1;
    ctx.translate(x, y);
    ctx.scale(dir, 1);

    ctx.fillStyle = 'rgba(180, 190, 205, 0.9)';
    ctx.strokeStyle = 'rgba(70, 90, 120, 0.65)';
    ctx.lineWidth = 2;

    ctx.beginPath();
    pathRoundRect(ctx, -w * 0.18, -h / 2, w * 0.36, h, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(60, 120, 240, 0.55)';
    const panelW = w * 0.34;
    const panelH = h * 0.85;
    ctx.fillRect(-w * 0.18 - panelW, -panelH / 2, panelW, panelH);
    ctx.fillRect(w * 0.18, -panelH / 2, panelW, panelH);

    ctx.strokeStyle = 'rgba(220, 235, 255, 0.35)';
    ctx.beginPath();
    ctx.moveTo(-w * 0.18, 0);
    ctx.lineTo(-w * 0.18 - panelW, 0);
    ctx.moveTo(w * 0.18, 0);
    ctx.lineTo(w * 0.18 + panelW, 0);
    ctx.stroke();

    ctx.restore();
  }

  private drawJunk(x: number, y: number, r: number, angle: number): void {
    const ctx = this.ctx;
    ctx.save();

    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.fillStyle = 'rgba(180, 140, 110, 0.85)';
    ctx.strokeStyle = 'rgba(255, 230, 210, 0.25)';
    ctx.lineWidth = 2;

    ctx.beginPath();
    pathRoundRect(ctx, -r, -r * 0.55, r * 2, r * 1.1, 4);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  private drawHud(heightM: number): void {
    const ctx = this.ctx;

    ctx.save();

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '600 14px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textBaseline = 'top';

    const h = Math.floor(heightM);
    const best = Math.floor(this.maxHeightM);

    const persistentBest = Math.floor(this.bestHeightM);
    const text =
      this.state === 'playing'
        ? `Height: ${h.toLocaleString()} m  Best: ${persistentBest.toLocaleString()} m`
        : `Max height: ${best.toLocaleString()} m  Best: ${persistentBest.toLocaleString()} m`;
    ctx.fillText(text, 14, 12);

    ctx.restore();
  }

  private drawCenteredOverlay(title: string, body: string): void {
    const ctx = this.ctx;

    ctx.save();

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const boxW = Math.min(520, this.cssW - 48);
    const boxH = 220;
    const x = (this.cssW - boxW) / 2;
    const y = (this.cssH - boxH) / 2;

    ctx.fillStyle = 'rgba(10, 14, 24, 0.88)';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pathRoundRect(ctx, x, y, boxW, boxH, 18);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textAlign = 'center';

    ctx.font = '700 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, this.cssW / 2, y + 72);

    ctx.font = '500 16px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillStyle = 'rgba(235, 245, 255, 0.9)';

    const lines = body.split('\n');
    let yy = y + 110;
    for (const line of lines) {
      ctx.fillText(line, this.cssW / 2, yy);
      yy += 24;
    }

    ctx.restore();
  }
}
