import type { ObjectDirective } from 'vue';

// Keep the real select (labels, form semantics and Vue v-model). Only its popup is
// drawn here, matching ChoiceMenu.swift without exposing any renderer Node API.
let nextID = 0;
let dismissCurrent: (() => void) | undefined;
const controls = new WeakMap<HTMLSelectElement, { refresh(): void; destroy(): void }>();

function attach(select: HTMLSelectElement) {
  if (select.multiple || select.size > 1) return;
  const id = `choice-list-${++nextID}`;
  const popup = document.createElement('div');
  popup.id = id;
  popup.className = 'choice-popup';
  popup.setAttribute('role', 'listbox');
  popup.setAttribute('popover', 'manual');
  // Staying inside the form/dialog keeps the popup in its modal accessibility tree.
  select.insertAdjacentElement('afterend', popup);
  select.classList.add('choice-control');
  select.setAttribute('aria-haspopup', 'listbox');
  select.setAttribute('aria-controls', id);
  select.setAttribute('aria-expanded', 'false');
  let open = false,
    highlighted = -1,
    query = '',
    typedAt = 0;
  let rows: HTMLElement[] = [];
  const options = () => Array.from(select.options);
  const enabled = (option: HTMLOptionElement | undefined) =>
    !!option &&
    !option.disabled &&
    !option.hidden &&
    !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled);
  const label = () =>
    select.getAttribute('aria-label') ||
    Array.from(select.labels || [])
      .map((l) =>
        l.childNodes.length
          ? Array.from(l.childNodes)
              .filter((n) => n !== select && n !== popup)
              .map((n) => n.textContent)
              .join('')
          : '',
      )
      .join(' ')
      .trim() ||
    '选项';
  const selectedTitle = () => select.selectedOptions[0]?.label || '';
  function highlight(index: number, scroll = true) {
    highlighted = index;
    rows.forEach((row, i) => row.classList.toggle('highlighted', i === index));
    if (index >= 0) {
      select.setAttribute('aria-activedescendant', `${id}-${index}`);
      if (scroll) rows[index]?.scrollIntoView({ block: 'nearest' });
    } else select.removeAttribute('aria-activedescendant');
  }
  function close() {
    if (!open) return;
    open = false;
    popup.hidePopover();
    popup.replaceChildren();
    rows = [];
    select.setAttribute('aria-expanded', 'false');
    select.removeAttribute('aria-activedescendant');
    if (dismissCurrent === close) dismissCurrent = undefined;
    query = '';
  }
  function place() {
    if (!open) return;
    const rect = select.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 200), 360, innerWidth - 12);
    const desired = Math.min(options().filter((o) => !o.hidden).length * 32 + 10, 330);
    const below = innerHeight - rect.bottom - 11,
      above = rect.top - 11;
    const flip = below < desired && above > below;
    const height = Math.max(0, Math.min(desired, flip ? above : below, innerHeight - 12));
    Object.assign(popup.style, {
      width: `${width}px`,
      maxHeight: `${height}px`,
      left: `${Math.max(6, Math.min(rect.left, innerWidth - width - 6))}px`,
      top: `${Math.max(6, Math.min(flip ? rect.top - height - 5 : rect.bottom + 5, innerHeight - height - 6))}px`,
    });
  }
  function render() {
    popup.setAttribute('aria-label', `${label()}选项`);
    rows = options().map((option, index) => {
      const row = document.createElement('div');
      row.id = `${id}-${index}`;
      row.className = 'choice-option';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === select.selectedIndex));
      row.setAttribute('aria-disabled', String(!enabled(option)));
      row.hidden = option.hidden;
      row.title = option.label;
      const check = document.createElement('span');
      check.className = 'choice-check';
      check.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'choice-label';
      text.textContent = option.label;
      row.append(check, text);
      row.addEventListener('pointermove', () => {
        if (enabled(option)) highlight(index, false);
      });
      row.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        choose(index);
      });
      return row;
    });
    popup.replaceChildren(...rows);
  }
  function show() {
    if (select.matches(':disabled') || !options().some(enabled)) return;
    dismissCurrent?.();
    select.focus({ preventScroll: true });
    render();
    open = true;
    dismissCurrent = close;
    popup.showPopover();
    select.setAttribute('aria-expanded', 'true');
    place();
    highlight(
      enabled(options()[select.selectedIndex])
        ? select.selectedIndex
        : options().findIndex(enabled),
    );
  }
  function choose(index: number) {
    if (!open || !options()[index] || !enabled(options()[index])) return;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    close();
    select.focus({ preventScroll: true });
    if (changed) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    refresh();
  }
  function refresh() {
    select.title = `${label()}：${selectedTitle()}`;
    if (!open) return;
    if (!select.isConnected || select.matches(':disabled') || !options().some(enabled))
      return close();
    render();
    if (!options()[highlighted] || !enabled(options()[highlighted]))
      highlighted = select.selectedIndex;
    place();
    highlight(highlighted);
  }
  function pointer(event: PointerEvent) {
    if (event.button !== 0 || select.matches(':disabled')) return;
    event.preventDefault();
    if (open) close();
    else show();
  }
  function click(event: MouseEvent) {
    // AT invokes click without pointerdown; don't open the Chromium popup.
    event.preventDefault();
    if (event.detail === 0) {
      if (open) close();
      else show();
    }
  }
  function key(event: KeyboardEvent) {
    if (
      event.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      (event.altKey && !['ArrowDown', 'ArrowUp'].includes(event.key))
    )
      return;
    if (event.key === 'Tab') {
      close();
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
      return;
    }
    const navigation = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'];
    if (
      !navigation.includes(event.key) &&
      !['Enter', ' '].includes(event.key) &&
      event.key.length !== 1
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!open) {
      show();
      if (event.key.length !== 1 || event.key === ' ') return;
    }
    if (!open) return;
    if (event.key === 'Enter' || event.key === ' ') return choose(highlighted);
    const available = options()
      .map((o, i) => (enabled(o) ? i : -1))
      .filter((i) => i >= 0);
    if (navigation.includes(event.key)) {
      const current = available.indexOf(highlighted);
      const step = event.key.startsWith('Page') ? 8 : 1;
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? available.length - 1
            : current + (event.key.endsWith('Down') ? step : -step);
      highlight(available[Math.max(0, Math.min(next, available.length - 1))]);
    } else {
      const now = Date.now();
      query = now - typedAt > 700 ? event.key : query + event.key;
      typedAt = now;
      const prefix = query.toLocaleLowerCase();
      const match = available.find((i) =>
        options()[i].label.toLocaleLowerCase().startsWith(prefix),
      );
      if (match !== undefined) highlight(match);
    }
  }
  function outside(event: PointerEvent) {
    if (event.target !== select && !popup.contains(event.target as Node)) close();
  }
  function scroll(event: Event) {
    if (event.target !== popup && !popup.contains(event.target as Node)) place();
  }
  function blur() {
    close();
  }
  function keepFocus(event: PointerEvent) {
    event.preventDefault();
  }
  select.addEventListener('pointerdown', pointer);
  select.addEventListener('click', click);
  select.addEventListener('keydown', key);
  select.addEventListener('change', refresh);
  select.addEventListener('blur', blur);
  popup.addEventListener('pointerdown', keepFocus);
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', scroll, true);
  window.addEventListener('blur', blur);
  const observer = new MutationObserver(refresh);
  observer.observe(select, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['disabled', 'hidden', 'label', 'value', 'selected'],
  });
  refresh();
  controls.set(select, {
    refresh,
    destroy() {
      close();
      observer.disconnect();
      popup.remove();
      select.removeEventListener('pointerdown', pointer);
      select.removeEventListener('click', click);
      select.removeEventListener('keydown', key);
      select.removeEventListener('change', refresh);
      select.removeEventListener('blur', blur);
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('blur', blur);
      controls.delete(select);
    },
  });
}
export const choice: ObjectDirective<HTMLSelectElement> = {
  mounted: attach,
  updated: (select) => controls.get(select)?.refresh(),
  beforeUnmount: (select) => controls.get(select)?.destroy(),
};
