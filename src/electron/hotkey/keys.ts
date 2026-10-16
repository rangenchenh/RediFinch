/**
 * Mapping between Electron accelerator strings (`Alt+Space`) and Windows
 * virtual-key codes, needed because the low-level keyboard hook speaks VK codes
 * while the Electron fallback speaks accelerators.
 */

export const MODIFIER_VKS = {
  ctrl: 0x11,
  control: 0x11,
  alt: 0x12,
  menu: 0x12,
  shift: 0x10,
  win: 0x5b,
  meta: 0x5b,
  super: 0x5b,
} as const;

const NAMED_VKS: Record<string, number> = {
  space: 0x20,
  tab: 0x09,
  backspace: 0x08,
  delete: 0x2e,
  insert: 0x2d,
  return: 0x0d,
  enter: 0x0d,
  escape: 0x1b,
  esc: 0x1b,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  capslock: 0x14,
  '`': 0xc0,
  '-': 0xbd,
  '=': 0xbb,
  '[': 0xdb,
  ']': 0xdd,
  '\\': 0xdc,
  ';': 0xba,
  "'": 0xde,
  ',': 0xbc,
  '.': 0xbe,
  '/': 0xbf,
};

export interface ParsedHotkey {
  /**
   * Virtual-key code of the key that acts as the trigger, or `0` when the chord
   * is made of modifiers only (`Ctrl+Win`).
   */
  vk: number;
  /** Virtual-key codes of any required modifiers. */
  modifiers: number[];
  /** Normalised accelerator, suitable for `globalShortcut.register`. */
  accelerator: string;
  /**
   * True when the whole chord is modifiers. Such a chord has no discrete
   * trigger key, so the hook treats "all modifiers held" as the down edge and
   * releasing any one of them as the up edge.
   */
  isModifierOnly: boolean;
}

/**
 * Parse an Electron-style accelerator into virtual-key codes.
 *
 * Returns `null` for anything unparseable. Modifier-only chords are supported —
 * `Ctrl+Win` is a common dictation binding precisely because it collides with
 * almost nothing — and are flagged so the hook can use chord-completion
 * semantics instead of looking for a trigger key.
 */
export function parseHotkey(accelerator: string): ParsedHotkey | null {
  const parts = accelerator
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const modifiers: number[] = [];
  const normalisedMods: string[] = [];
  let vk: number | null = null;
  let mainToken = '';

  for (const part of parts) {
    const lower = part.toLowerCase();
    const mod = MODIFIER_VKS[lower as keyof typeof MODIFIER_VKS];

    if (mod !== undefined && vk === null) {
      if (!modifiers.includes(mod)) modifiers.push(mod);
      const canonical =
        lower === 'control'
          ? 'Ctrl'
          : lower === 'menu'
            ? 'Alt'
            : lower === 'super' || lower === 'meta' || lower === 'win'
              ? 'Super'
              : capitalise(lower);
      if (!normalisedMods.includes(canonical)) normalisedMods.push(canonical);
      continue;
    }

    if (vk !== null) return null; // two non-modifier keys is not a hotkey
    const resolved = resolveKey(lower);
    if (resolved === null) return null;
    vk = resolved;
    mainToken = part;
  }

  if (vk === null) {
    // Every token was a modifier: `Ctrl+Win`, `Alt+Shift`, and so on.
    if (modifiers.length === 0) return null;
    return {
      vk: 0,
      modifiers,
      accelerator: normalisedMods.join('+'),
      isModifierOnly: true,
    };
  }

  return {
    vk,
    modifiers,
    accelerator: [...normalisedMods, mainToken].join('+'),
    isModifierOnly: false,
  };
}

function resolveKey(token: string): number | null {
  if (NAMED_VKS[token] !== undefined) return NAMED_VKS[token];
  if (/^f([1-9]|1\d|2[0-4])$/.test(token)) return 0x70 + (Number(token.slice(1)) - 1);
  if (/^[a-z]$/.test(token)) return token.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(token)) return 0x30 + Number(token);
  // Electron also accepts key names like `num0`, `numpad0`.
  if (/^num(?:pad)?([0-9])$/.test(token)) {
    return 0x60 + Number(/^num(?:pad)?([0-9])$/.exec(token)![1]);
  }
  return null;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Human-readable label, e.g. `Alt + Space` or `Ctrl + Win`.
 *
 * Electron calls the Windows key `Super`; users call it Win. Translate for
 * display only — the stored value stays in Electron's vocabulary so
 * `globalShortcut.register` still understands it.
 */
export function describeHotkey(accelerator: string): string {
  const parsed = parseHotkey(accelerator);
  if (!parsed) return accelerator;
  return parsed.accelerator
    .split('+')
    .map((part) => {
      if (part === 'Super' || part === 'Meta') return 'Win';
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(' + ');
}
