/**
 * Modifier-chord matching for the low-level keyboard hook.
 *
 * Split out from the hook itself so it can be tested directly. The logic here
 * is the part that silently fails: a low-level hook reports *left/right
 * specific* virtual-key codes (left Ctrl is 0xA2, never 0x11), so comparing a
 * configured chord against generic codes makes the hotkey appear dead while
 * every diagnostic reports the hook as healthy. That deserves a test, and a
 * test needs this to be importable without spawning a message pump.
 *
 * Pure module: no Win32, no I/O, no side effects.
 */

/**
 * Generic modifier code -> every specific code Windows may report for it.
 *
 * Both Win keys map to one group on purpose: a user pressing "Ctrl+Win" does
 * not care which Win key they hit, so right-Win must not be a dead key.
 */
const VK_ALIASES = new Map([
  [0x10, [0xa0, 0xa1]], // Shift -> LShift, RShift
  [0x11, [0xa2, 0xa3]], // Ctrl  -> LCtrl,  RCtrl
  [0x12, [0xa4, 0xa5]], // Alt   -> LAlt,  RAlt
  [0x5b, [0x5b, 0x5c]], // Win   -> LWin,  RWin
]);

/** Every virtual-key code that should count as "this key is held". */
function expandVk(vk) {
  return VK_ALIASES.get(vk) ?? [vk];
}

/**
 * The canonical code for whichever physical modifier `vk` belongs to, or null
 * if it is not a modifier we track.
 */
function modifierGroup(vk) {
  for (const [generic, aliases] of VK_ALIASES) {
    if (generic === vk || aliases.includes(vk)) return generic;
  }
  return null;
}

/** Normalise any specific code to its canonical group, leaving others alone. */
function canonical(vk) {
  return modifierGroup(vk) ?? vk;
}

/**
 * Build the matcher for one configured chord.
 *
 * @param {number[]} modifierVks  canonical modifier codes the chord requires
 * @param {number} [triggerVk]    the distinct trigger key, or 0 when the chord
 *                                is modifiers only. This is what decides
 *                                `chordOnly` — a chord like Alt+Space has a
 *                                modifier *and* a trigger, so it is not
 *                                modifier-only even though every modifier it
 *                                names is, in fact, a modifier.
 */
function createMatcher(modifierVks, triggerVk = 0) {
  const requiredGroups = new Set(
    modifierVks.filter((v) => v > 0).map((v) => canonical(v)),
  );

  /** Is this key part of the chord at all? */
  function isTrackedModifier(vk) {
    const group = modifierGroup(vk);
    return group !== null && requiredGroups.has(group);
  }

  /**
   * Is every required modifier currently held?
   *
   * @param {Set<number>|number[]} held specific codes seen as down
   */
  function chordSatisfied(held) {
    const groups = new Set();
    for (const vk of held) groups.add(canonical(vk));
    for (const required of requiredGroups) {
      if (!groups.has(required)) return false;
    }
    return true;
  }

  /**
   * Does this key match the chord's distinct trigger key?
   *
   * `explicit` lets a caller override the trigger it was constructed with, which
   * keeps the function honest when the two disagree.
   */
  function matchesTrigger(explicit, vk) {
    const target = explicit === undefined ? triggerVk : explicit;
    if (!target) return false; // chord-only: no distinct trigger to match
    return canonical(vk) === canonical(target);
  }

  return {
    isTrackedModifier,
    chordSatisfied,
    matchesTrigger,
    requiredGroups,
    /**
     * True when the chord is modifiers only, so "all modifiers held" is the
     * down edge and releasing any one of them is the up edge.
     */
    get chordOnly() {
      return triggerVk === 0 && requiredGroups.size > 0;
    },
  };
}

/** Match several chords at once, preferring the most specific chord. */
function createMultiMatcher(bindings) {
  const held = new Set();
  let activeId = null;
  const configured = bindings.map((binding) => ({
    id: binding.id,
    vk: binding.vk,
    groups: new Set(binding.mods.map(canonical)),
  }));

  function selected() {
    const groups = new Set([...held].map(modifierGroup).filter((v) => v !== null));
    const candidates = configured.filter((binding) => {
      if (groups.size !== binding.groups.size) return false;
      for (const group of binding.groups) if (!groups.has(group)) return false;
      return binding.vk === 0 || [...held].some((vk) => canonical(vk) === canonical(binding.vk));
    });
    candidates.sort((a, b) => b.groups.size - a.groups.size || Number(b.vk !== 0) - Number(a.vk !== 0));
    return candidates[0]?.id ?? null;
  }

  function transition(vk, isDown, isUp) {
    if (!isDown && !isUp) return null;
    if (isDown) {
      if (held.has(vk)) return null; // auto-repeat
      held.add(vk);
    } else {
      held.delete(vk);
    }
    const next = selected();
    if (next === activeId) return null;
    const previous = activeId;
    activeId = next;
    if (previous === null) return { type: 'down', id: next };
    if (next === null) return { type: 'up', id: previous };
    return { type: 'switch', id: next };
  }

  return { transition, get activeId() { return activeId; } };
}

module.exports = {
  VK_ALIASES,
  expandVk,
  modifierGroup,
  canonical,
  createMatcher,
  createMultiMatcher,
};
