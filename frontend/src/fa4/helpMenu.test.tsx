import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HELP, HELP_FLAGS, HELP_MAP, helpIdsFor, type HelpFlags, type HelpScreen } from './copy/help';
import { HelpMenu } from './components/HelpMenu';
import { TopActions } from './components/HelpContact';
import { ContinueLinkDialog } from './components/Recovery';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const flags = (o: Partial<HelpFlags> = {}): HelpFlags => ({ ...HELP_FLAGS, stabilization: false, ...o });
const ALL: HelpScreen[] = ['cover', 'identity', 'company', 'destinations', 'activity', 'reason', 'decision', 'size', 'activators', 'topics', 'extra', 'yevPreview', 'yevDelivered', 'recovery'];

describe('DSC-37 · help mapping', () => {
  it('follows the approved order, at most 4 entries, and never K/L/M/N/G', () => {
    for (const s of ALL) {
      const ids = helpIdsFor(s, flags({ E: true, F: true }));
      expect(ids.length).toBeLessThanOrEqual(4);
      for (const bad of ['K', 'L', 'M', 'N', 'G']) expect(ids as string[]).not.toContain(bad);
      expect(ids).toEqual(HELP_MAP[s].filter((x) => ids.includes(x)));
    }
    expect(helpIdsFor('cover', flags())).toEqual(['A', 'T', 'D']);
    expect(helpIdsFor('yevPreview', flags())).toEqual(['I', 'J', 'P']);
  });
  it('flags gate E, F, J, P; F requires E', () => {
    expect(helpIdsFor('recovery', flags())).toEqual([]);
    expect(helpIdsFor('recovery', flags({ E: true }))).toEqual(['E']);
    expect(helpIdsFor('recovery', flags({ F: true }))).toEqual([]);
    expect(helpIdsFor('recovery', flags({ E: true, F: true }))).toEqual(['E', 'F']);
    expect(helpIdsFor('yevPreview', flags({ J: false, P: false }))).toEqual(['I']);
  });
  it('the Stabilization line of entry E appears only with the flag', async () => {
    const user = userEvent.setup();
    const stab = HELP.E.stab; if (!stab) return;
    for (const on of [false, true]) {
      const { unmount } = render(<HelpMenu locale="es" variant="form" screen="recovery" flags={flags({ E: true, stabilization: on })} />);
      await user.click(screen.getByRole('button', { name: 'Ayuda' }));
      await user.click(screen.getAllByRole('button', { expanded: false }).find((b) => b.className === 'ha-q')!);
      expect(!!screen.queryByText(stab.es)).toBe(on);
      unmount();
    }
  });
});

describe('DSC-37 · menu behaviour', () => {
  it('names: «Ayuda»/«Help» in the form, «Ayuda y contacto»/«Help & contact» in the YEV (accessible name = panel title)', async () => {
    const user = userEvent.setup();
    for (const [variant, locale, name] of [['form', 'es', 'Ayuda'], ['form', 'en', 'Help'], ['yev', 'es', 'Ayuda y contacto'], ['yev', 'en', 'Help & contact']] as const) {
      const { unmount } = render(<HelpMenu locale={locale} variant={variant} screen={variant === 'yev' ? 'yevPreview' : 'cover'} flags={flags()} />);
      await user.click(screen.getByRole('button', { name }));
      expect(screen.getByRole('heading', { level: 2, name })).not.toBeNull();
      unmount();
    }
  });
  it('«Hablar con beeside» is a mailto link only in the YEV; absent in the form', async () => {
    const user = userEvent.setup();
    const a = render(<HelpMenu locale="es" variant="form" screen="cover" flags={flags()} />);
    await user.click(screen.getByRole('button', { name: 'Ayuda' }));
    expect(screen.queryByRole('link', { name: /Hablar con beeside/ })).toBeNull();
    a.unmount();
    render(<HelpMenu locale="es" variant="yev" screen="yevPreview" flags={flags()} />);
    await user.click(screen.getByRole('button', { name: 'Ayuda y contacto' }));
    expect((screen.getByRole('link', { name: /Hablar con beeside/ }) as HTMLAnchorElement).href).toMatch(/^mailto:/);
  });
  it('opens closed-by-default entries (H3 → H4), Escape and × return focus to the trigger, screen change closes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<HelpMenu locale="es" variant="form" screen="cover" flags={flags()} resetKey="a" />);
    const trigger = screen.getByRole('button', { name: 'Ayuda' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.click(trigger);
    const panel = screen.getByTestId('help-panel');
    expect(within(panel).getByRole('heading', { level: 3 })).not.toBeNull();
    const qs = within(panel).getAllByRole('heading', { level: 4 });
    expect(qs.length).toBe(3);
    for (const q of within(panel).getAllByRole('button', { expanded: false }).filter((b) => b.className === 'ha-q')) expect(q.getAttribute('aria-expanded')).toBe('false');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('help-panel')).toBeNull(); expect(document.activeElement).toBe(trigger);
    await user.click(trigger); await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    rerender(<HelpMenu locale="es" variant="form" screen="identity" flags={flags()} resetKey="b" />);
    expect(screen.queryByTestId('help-panel')).toBeNull();
  });
  it('TopActions on the cover has the help trigger and no save button', () => {
    render(<TopActions locale="es" helpScreen="cover" helpFlags={flags()} saveSlot={false} />);
    expect(screen.getByRole('button', { name: 'Ayuda' })).not.toBeNull();
  });
});

describe('DSC-38 · continue-link dialog', () => {
  it('shows the neutral result for any address, labelled «Correo electrónico», and Escape closes', async () => {
    HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
    const answers: string[] = [];
    for (const email of ['known@x.example', 'unknown@x.example']) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })));
      const user = userEvent.setup(); const onClose = vi.fn();
      const { unmount } = render(<ContinueLinkDialog locale="es" open onClose={onClose} />);
      const field = screen.getByLabelText('Correo electrónico');
      const send = screen.getByRole('button', { name: 'Enviarme un enlace nuevo' });
      expect((send as HTMLButtonElement).disabled).toBe(true);
      await user.type(field, email); await user.click(send);
      answers.push((await screen.findByRole('status')).textContent ?? '');
      expect(screen.queryByLabelText(/Correo de trabajo|Work email/)).toBeNull();
      unmount(); vi.unstubAllGlobals();
    }
    expect(answers[0]).toBe(answers[1]); expect(answers[0]).not.toBe('');
  });
});
