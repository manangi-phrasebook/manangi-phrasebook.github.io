// Required once per browser before a recording is saved. The database refuses recordings without a
// consent version, so this is enforced server-side too; the browser only remembers the tick.
import { STRINGS } from './i18n.js';

const KEY = 'manangi-consent';

export function hasConsented() {
  try { return localStorage.getItem(KEY) === 'yes'; } catch { return false; }
}

function remember() {
  try { localStorage.setItem(KEY, 'yes'); } catch { /* asked again next visit; harmless */ }
}

/** A checkbox row to place before Save. `accepted()` is true once ticked (or ticked on an earlier visit). */
export function consentField(lang) {
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: hasConsented() });
  const label = document.createElement('label');
  label.className = 'consent';
  label.append(box, ' ', STRINGS[lang].consent);
  return {
    element: label,
    accepted: () => {
      if (box.checked) remember();
      return box.checked;
    },
  };
}
