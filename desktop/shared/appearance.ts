/** Swift ColorPalette / AppearanceTransitionSettings wire format. */
export type Appearance = 'system' | 'light' | 'dark';
export interface AppearanceTransition {
  isEnabled: boolean;
  direction: 'top' | 'bottom' | 'left' | 'right';
  speed: number;
  colorMode: 'solid' | 'rainbow';
  colorHex: string;
}
export interface AppearancePatch {
  appearance?: Appearance;
  accentColor?: string;
  showCourseBorders?: boolean;
  appearanceTransition?: AppearanceTransition;
}
export const defaultTransition: AppearanceTransition = {
  isEnabled: true,
  direction: 'top',
  speed: 1,
  colorMode: 'solid',
  colorHex: '#808080',
};
export const accentPresets = [
  ['松柏绿', '#39786B'],
  ['湖水青', '#287D8E'],
  ['晴空蓝', '#3B72B8'],
  ['靛青', '#5555A5'],
  ['鸢尾紫', '#8058A1'],
  ['玫瑰粉', '#AE567C'],
  ['砖红', '#B2534D'],
  ['陶土橙', '#AC633C'],
  ['琥珀金', '#967326'],
  ['橄榄绿', '#6C7E3D'],
  ['咖啡棕', '#826452'],
  ['石墨灰', '#596574'],
] as const;
export const rainbow = [
  '#E85B65',
  '#ED8659',
  '#E8AD4A',
  '#DFCE58',
  '#9DC96A',
  '#58B791',
  '#4DB6BB',
  '#568CC9',
  '#7A75C9',
  '#AE73BD',
];
export function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const text = value.trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(text) ? '#' + text.toUpperCase() : undefined;
}
export function transitionSettings(value: unknown): AppearanceTransition {
  const v = { ...defaultTransition, ...(value && typeof value === 'object' ? value : {}) };
  return {
    isEnabled: typeof v.isEnabled === 'boolean' ? v.isEnabled : true,
    direction: ['top', 'bottom', 'left', 'right'].includes(v.direction) ? v.direction : 'top',
    speed: Number.isFinite(v.speed) && v.speed >= 0.5 && v.speed <= 2 ? v.speed : 1,
    colorMode: v.colorMode === 'rainbow' ? 'rainbow' : 'solid',
    colorHex: normalizeHex(v.colorHex) ?? '#808080',
  };
}
export function validateAppearancePatch(value: unknown): AppearancePatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效外观设置');
  const v = value as Record<string, unknown>;
  if (
    !Object.keys(v).length ||
    Object.keys(v).some(
      (k) =>
        !['appearance', 'accentColor', 'showCourseBorders', 'appearanceTransition'].includes(k),
    )
  )
    throw new Error('未知外观字段');
  const result: AppearancePatch = {};
  if ('appearance' in v) {
    if (!['system', 'light', 'dark'].includes(v.appearance as string)) throw new Error('未知外观');
    result.appearance = v.appearance as Appearance;
  }
  if ('accentColor' in v) {
    const hex = normalizeHex(v.accentColor);
    if (!hex) throw new Error('请输入六位 HEX 颜色');
    result.accentColor = hex;
  }
  if ('showCourseBorders' in v) {
    if (typeof v.showCourseBorders !== 'boolean') throw new Error('无效课程边框设置');
    result.showCourseBorders = v.showCourseBorders;
  }
  if ('appearanceTransition' in v) {
    const t = v.appearanceTransition as AppearanceTransition;
    if (
      !t ||
      typeof t !== 'object' ||
      Array.isArray(t) ||
      Object.keys(t).some((k) => !Object.keys(defaultTransition).includes(k)) ||
      typeof t.isEnabled !== 'boolean' ||
      !['top', 'bottom', 'left', 'right'].includes(t.direction) ||
      !Number.isFinite(t.speed) ||
      t.speed < 0.5 ||
      t.speed > 2 ||
      !['solid', 'rainbow'].includes(t.colorMode) ||
      !normalizeHex(t.colorHex)
    )
      throw new Error('无效切换动效设置');
    result.appearanceTransition = { ...t, colorHex: normalizeHex(t.colorHex)! };
  }
  return result;
}
type RGB = [number, number, number];
const rgb = (hex: string): RGB =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
function luminance(c: RGB) {
  const linear = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
export function contrastRatio(a: RGB, b: RGB) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function contrastColor(hex: string, background: string, minimum = 4.5): RGB {
  const source = rgb(normalizeHex(hex) ?? '#39786B'),
    bg = rgb(background);
  if (contrastRatio(source, bg) >= minimum) return source;
  const end: RGB =
    contrastRatio([0, 0, 0], bg) >= contrastRatio([1, 1, 1], bg) ? [0, 0, 0] : [1, 1, 1];
  let lo = 0,
    hi = 1;
  const mix = (amount: number) => source.map((v, i) => v + (end[i] - v) * amount) as RGB;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mix(mid), bg) >= minimum) hi = mid;
    else lo = mid;
  }
  return mix(hi);
}
export const cssColor = (color: RGB) => `rgb(${color.map((v) => v * 255).join(' ')})`;

/** Deterministic ten-strip animation; reversal starts at current opacity, never flashes. */
export class AppearanceCurtain {
  phase: 'idle' | 'cover' | 'hold' | 'reveal' = 'idle';
  settings = { ...defaultTransition };
  target: Appearance = 'system';
  opacity = Array<number>(10).fill(0);
  private from = [...this.opacity];
  private started = 0;
  private previewOnly = false;
  private apply: (mode: Appearance) => void;
  constructor(apply: (mode: Appearance) => void) {
    this.apply = apply;
  }
  request(
    mode: Appearance,
    settings: AppearanceTransition,
    now: number,
    animate: boolean,
    preview = false,
  ) {
    if (preview && this.phase !== 'idle') return;
    this.target = mode;
    this.previewOnly = preview;
    if (!animate || !settings.isEnabled) {
      this.finish();
      return;
    }
    if (this.phase === 'cover') return;
    if (this.phase === 'hold') {
      if (!preview) this.apply(mode);
      return;
    }
    if (this.phase === 'idle') this.settings = { ...settings };
    this.from = [...this.opacity];
    this.started = now;
    this.phase = 'cover';
  }
  tick(now: number) {
    const duration = 740 / this.settings.speed;
    const stagger = (progress: number, i: number, spread: number) => {
      const t = Math.max(0, Math.min(1, (progress - (spread * i) / 9) / (1 - spread)));
      return 1 - (1 - t) ** 3;
    };
    if (this.phase === 'cover') {
      const progress = (now - this.started) / (duration * 0.4);
      this.opacity = this.from.map((v, i) => v + (1 - v) * stagger(progress, i, 0.6));
      if (progress >= 1) {
        if (!this.previewOnly) this.apply(this.target);
        this.phase = 'hold';
        this.started += duration * 0.4;
      }
    }
    if (this.phase === 'hold' && now - this.started >= duration * 0.1) {
      this.phase = 'reveal';
      this.started += duration * 0.1;
    }
    if (this.phase === 'reveal') {
      const progress = (now - this.started) / (duration * 0.5);
      this.opacity = this.opacity.map((_, i) => 1 - stagger(progress, 9 - i, 0.55));
      if (progress >= 1) this.finish();
    }
  }
  finish() {
    if (!this.previewOnly) this.apply(this.target);
    this.opacity = Array<number>(10).fill(0);
    this.phase = 'idle';
  }
}
