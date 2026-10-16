/**
 * Unit tests for the modifier-chord matcher.
 *
 * These exist because the hotkey failure was invisible to every other check: the
 * hook installed, reported ready, and the app logged it as "active" — while the
 * chord could never match. The only way to catch that without a human holding a
 * key is to drive the matcher directly with the codes Windows really sends.
 *
 * Run: `npm run test:keys`
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createMatcher, createMultiMatcher, canonical } = require(path.join(root, 'src/electron/hotkey/keymatch.cjs'));

let failed = 0;
let passed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `\n      got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

// Real virtual-key codes a low-level hook delivers.
const VK = {
  LCTRL: 0xa2, RCTRL: 0xa3,
  LSHIFT: 0xa0, RSHIFT: 0xa1,
  LALT: 0xa4, RALT: 0xa5,
  LWIN: 0x5b, RWIN: 0x5c,
  GENERIC_CTRL: 0x11, GENERIC_ALT: 0x12, GENERIC_SHIFT: 0x10,
  SPACE: 0x20,
};

console.log('\nGeneric -> specific aliasing');
check('left Ctrl canonicalises to generic Ctrl', canonical(VK.LCTRL), VK.GENERIC_CTRL);
check('right Ctrl canonicalises to generic Ctrl', canonical(VK.RCTRL), VK.GENERIC_CTRL);
check('right Win canonicalises to generic Win', canonical(VK.RWIN), VK.LWIN);
check('Space is left alone', canonical(VK.SPACE), VK.SPACE);

console.log('\nCtrl+Win chord (the configured default)');
{
  const m = createMatcher([VK.GENERIC_CTRL, VK.LWIN]);
  check('is a modifier-only chord', m.chordOnly, true);
  check('not satisfied by nothing', m.chordSatisfied(new Set()), false);
  check('not satisfied by Ctrl alone', m.chordSatisfied(new Set([VK.LCTRL])), false);
  check('not satisfied by Win alone', m.chordSatisfied(new Set([VK.LWIN])), false);

  // The regression: a real keypress reports the specific codes, not the generic
  // ones the chord was configured with.
  check(
    'satisfied by LCtrl + LWin',
    m.chordSatisfied(new Set([VK.LCTRL, VK.LWIN])),
    true,
  );
  check(
    'satisfied by RCtrl + LWin',
    m.chordSatisfied(new Set([VK.RCTRL, VK.LWIN])),
    true,
  );
  check(
    'satisfied by LCtrl + RWin',
    m.chordSatisfied(new Set([VK.LCTRL, VK.RWIN])),
    true,
  );
  check(
    'satisfied when generic codes are reported',
    m.chordSatisfied(new Set([VK.GENERIC_CTRL, VK.LWIN])),
    true,
  );
  check('Ctrl is a tracked modifier', m.isTrackedModifier(VK.LCTRL), true);
  check('Win is a tracked modifier', m.isTrackedModifier(VK.RWIN), true);
  check('Space is not a tracked modifier', m.isTrackedModifier(VK.SPACE), false);
  check('Shift is not part of this chord', m.isTrackedModifier(VK.LSHIFT), false);
  check('a chord-only binding has no trigger key', m.matchesTrigger(0, VK.LCTRL), false);
}

console.log('\nAlt+Space chord (trigger key + modifier)');
{
  const m = createMatcher([VK.GENERIC_ALT], VK.SPACE);
  check('is not modifier-only', m.chordOnly, false);
  check('Space matches the trigger', m.matchesTrigger(VK.SPACE, VK.SPACE), true);
  check('Ctrl does not match the trigger', m.matchesTrigger(VK.SPACE, VK.LCTRL), false);
  check('Alt is a tracked modifier', m.isTrackedModifier(VK.LALT), true);
  check('RAlt is a tracked modifier', m.isTrackedModifier(VK.RALT), true);
  check('not satisfied without Alt', m.chordSatisfied(new Set()), false);
  check('satisfied with LAlt held', m.chordSatisfied(new Set([VK.LALT])), true);
  check('satisfied with RAlt held', m.chordSatisfied(new Set([VK.RALT])), true);
}

console.log('\nCtrl+Shift+Space chord');
{
  const m = createMatcher([VK.GENERIC_CTRL, VK.GENERIC_SHIFT], VK.SPACE);
  check(
    'needs both modifiers',
    m.chordSatisfied(new Set([VK.LCTRL, VK.LSHIFT])),
    true,
  );
  check('fails with only Ctrl', m.chordSatisfied(new Set([VK.LCTRL])), false);
  check(
    'fails with mixed specific codes for one modifier only',
    m.chordSatisfied(new Set([VK.LCTRL, VK.RCTRL])),
    false,
  );
  check('Space matches the trigger', m.matchesTrigger(VK.SPACE, VK.SPACE), true);
}

console.log('\nOverlapping mode shortcuts');
{
  const bindings = [
    { id: 'current', vk: 0, mods: [VK.GENERIC_CTRL, VK.LWIN] },
    { id: 'translate-llm', vk: 0, mods: [VK.GENERIC_CTRL, VK.LWIN, VK.GENERIC_SHIFT] },
  ];
  const m = createMultiMatcher(bindings);
  check('first modifier does nothing', m.transition(VK.LCTRL, true, false), null);
  check('base chord starts', m.transition(VK.RWIN, true, false), { type: 'down', id: 'current' });
  check('repeat is ignored', m.transition(VK.RWIN, true, false), null);
  check('Shift upgrades active mode', m.transition(VK.RSHIFT, true, false), { type: 'switch', id: 'translate-llm' });
  check('release Shift reveals base chord', m.transition(VK.RSHIFT, false, true), { type: 'switch', id: 'current' });
  check('release Ctrl ends chord', m.transition(VK.LCTRL, false, true), { type: 'up', id: 'current' });
  check('release Win after end does nothing', m.transition(VK.RWIN, false, true), null);

  const shifted = createMultiMatcher(bindings);
  check('Shift first does nothing', shifted.transition(VK.LSHIFT, true, false), null);
  check('Shift and Ctrl still wait', shifted.transition(VK.RCTRL, true, false), null);
  check('three modifiers start AI translation directly', shifted.transition(VK.LWIN, true, false), { type: 'down', id: 'translate-llm' });
  check('releasing Win ends', shifted.transition(VK.LWIN, false, true), { type: 'up', id: 'translate-llm' });
}

console.log('\nModifier plus trigger');
{
  const m = createMultiMatcher([{ id: 'polish', vk: VK.SPACE, mods: [VK.GENERIC_ALT] }]);
  check('right Alt alone waits', m.transition(VK.RALT, true, false), null);
  check('Space starts polish', m.transition(VK.SPACE, true, false), { type: 'down', id: 'polish' });
  check('release Alt ends even with Space held', m.transition(VK.RALT, false, true), { type: 'up', id: 'polish' });
}

console.log(`\n  ${passed}/${passed + failed} assertions passed`);
if (failed > 0) {
  console.log(`\n  ${failed} FAILED`);
  process.exit(1);
}
