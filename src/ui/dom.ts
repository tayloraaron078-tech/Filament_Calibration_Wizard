/** Tiny DOM helpers — no framework, just ergonomic element creation. */

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'dataset' && typeof v === 'object') {
      for (const [dk, dv] of Object.entries(v as Record<string, string>)) el.dataset[dk] = dv;
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'value' && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
      el.value = String(v);
    } else if (k === 'checked' && el instanceof HTMLInputElement) {
      el.checked = Boolean(v);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: (Child | Child[])[]): void {
  for (const c of children) {
    if (Array.isArray(c)) { append(el, c); continue; }
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

/** Build a DocumentFragment from children, skipping null/undefined/false. */
export function frag(...children: (Child | Child[])[]): DocumentFragment {
  const f = document.createDocumentFragment();
  const host = h('div', {}, ...children);
  while (host.firstChild) f.append(host.firstChild);
  return f;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// --- toast -----------------------------------------------------------------

let toastHost: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  toastHost.append(t);
  setTimeout(() => { t.classList.add('toast-out'); setTimeout(() => t.remove(), 400); }, 3500);
}

// --- modal / confirm -------------------------------------------------------

export function confirmDialog(opts: { title: string; body: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise(resolve => {
    const close = (result: boolean) => { overlay.remove(); resolve(result); };
    const overlay = h('div', { class: 'modal-overlay', onClick: (e: Event) => { if (e.target === overlay) close(false); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
        h('h3', {}, opts.title),
        h('p', {}, opts.body),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', onClick: () => close(false) }, 'Cancel'),
          h('button', {
            class: `btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`,
            onClick: () => close(true)
          }, opts.confirmLabel ?? 'Confirm')
        )
      )
    );
    document.body.append(overlay);
    (overlay.querySelector('button') as HTMLButtonElement)?.focus();
    overlay.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Escape') close(false); });
  });
}

// --- small builders --------------------------------------------------------

export function field(labelText: string, input: HTMLElement, help?: string): HTMLElement {
  const id = input.getAttribute('id') ?? `f-${Math.random().toString(36).slice(2, 8)}`;
  input.setAttribute('id', id);
  return h('div', { class: 'field' },
    h('label', { for: id }, labelText),
    input,
    help ? h('p', { class: 'field-help' }, help) : null
  );
}

export function numberInput(attrs: Record<string, unknown>): HTMLInputElement {
  return h('input', { type: 'number', inputmode: 'decimal', ...attrs });
}

export function issueList(issues: { level: 'error' | 'warning'; message: string }[]): HTMLElement | null {
  if (!issues.length) return null;
  return h('ul', { class: 'issues' },
    issues.map(i => h('li', { class: `issue issue-${i.level}` },
      h('span', { class: 'issue-icon', 'aria-hidden': 'true' }, i.level === 'error' ? '✖' : '⚠'),
      h('span', { class: 'sr-only' }, i.level === 'error' ? 'Error: ' : 'Warning: '),
      i.message))
  );
}

export function download(filename: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
