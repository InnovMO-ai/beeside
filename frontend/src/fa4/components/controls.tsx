import { useId, useState, type ReactNode } from 'react';
import type { Locale } from '@beeside/fa-public-engine';
import { allCountries } from '../copy/countries';
import { UI } from '../copy/ui';

export function Label({ children, id }: { children: ReactNode; id?: string }) { return <span className="label" id={id}>{children}</span>; }

export function TextField({ label, value, onChange, type = 'text', placeholder, help, autoComplete, invalid, multiline }: {
  label: ReactNode; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; help?: ReactNode; autoComplete?: string; invalid?: string; multiline?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {multiline
        ? <textarea id={id} className="field" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input id={id} className="field" type={type} value={value} placeholder={placeholder} autoComplete={autoComplete} aria-invalid={!!invalid} aria-describedby={help || invalid ? `${id}-d` : undefined} onChange={(e) => onChange(e.target.value)} />}
      {(help || invalid) && <p id={`${id}-d`} className={invalid ? 'help' : 'help'} role={invalid ? 'alert' : undefined} style={invalid ? { color: '#a1261b' } : undefined}>{invalid ?? help}</p>}
    </div>
  );
}

/** Single choice (radio group) */
export function RadioGroup<T extends string>({ legend, value, options, onChange, two }: {
  legend?: ReactNode; value: T | null; options: Array<{ value: T; label: ReactNode; sub?: ReactNode }>; onChange: (v: T) => void; two?: boolean;
}) {
  const name = useId();
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      {legend && <legend className="label">{legend}</legend>}
      <div className={`choices ${two ? 'two' : ''}`}>
        {options.map((o) => (
          <label key={o.value} className={`choice ${value === o.value ? 'on' : ''}`}>
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}{o.sub && <span className="sub">{o.sub}</span>}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Multiple choice (checkbox group) */
export function CheckGroup<T extends string>({ legend, values, options, onChange, two }: {
  legend?: ReactNode; values: T[]; options: Array<{ value: T; label: ReactNode; sub?: ReactNode }>; onChange: (v: T[]) => void; two?: boolean;
}) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      {legend && <legend className="label">{legend}</legend>}
      <div className={`choices ${two ? 'two' : ''}`}>
        {options.map((o) => {
          const on = values.includes(o.value);
          return (
            <label key={o.value} className={`choice ${on ? 'on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => onChange(on ? values.filter((x) => x !== o.value) : [...values, o.value])} />
              <span>{o.label}{o.sub && <span className="sub">{o.sub}</span>}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ChipGroup<T extends string>({ legend, value, options, onChange }: { legend?: ReactNode; value: T | null; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      {legend && <legend className="label">{legend}</legend>}
      <div className="chips" role="radiogroup">
        {options.map((o) => <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className={`chip ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>{o.label}</button>)}
      </div>
    </fieldset>
  );
}
export function ChipMulti<T extends string>({ legend, values, options, onChange }: { legend?: ReactNode; values: T[]; options: Array<{ value: T; label: string }>; onChange: (v: T[]) => void }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      {legend && <legend className="label">{legend}</legend>}
      <div className="chips">
        {options.map((o) => { const on = values.includes(o.value); return <button type="button" key={o.value} aria-pressed={on} className={`chip ${on ? 'on' : ''}`} onClick={() => onChange(on ? values.filter((x) => x !== o.value) : [...values, o.value])}>{o.label}</button>; })}
      </div>
    </fieldset>
  );
}

/** Segmented status control (e.g. Resolved / Under way / Pending / Not sure) */
export function Segmented<T extends string>({ label, value, options, onChange, cols }: { label: string; value: T | undefined; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; cols?: 3 | 4 }) {
  return (
    <div className={`seg ${cols === 3 ? 'three' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

/** Country multi-select with search (works at 375 px: one column, 44px targets). */
export function CountryPicker({ locale, selected, onChange, single, disabledOpen }: {
  locale: Locale; selected: string[]; onChange: (iso: string[]) => void; single?: boolean; disabledOpen?: boolean;
}) {
  const [q, setQ] = useState('');
  const id = useId();
  const all = allCountries(locale);
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const results = q.trim() ? all.filter((c) => norm(c.name).includes(norm(q)) && !selected.includes(c.iso)).slice(0, 6) : [];
  const name = (iso: string) => all.find((c) => c.iso === iso)?.name ?? iso;
  return (
    <div>
      <label htmlFor={id} className="sr-only">{UI.searchCountry[locale]}</label>
      <input id={id} className="field" type="search" placeholder={UI.searchCountry[locale]} value={q} disabled={disabledOpen} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {q.trim() !== '' && (
        <ul className="choices" style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }} aria-label={UI.searchCountry[locale]}>
          {results.length === 0 && <li className="hint">{UI.none[locale]}</li>}
          {results.map((c) => <li key={c.iso}><button type="button" className="choice" onClick={() => { onChange(single ? [c.iso] : [...selected, c.iso]); setQ(''); }}>{c.name}</button></li>)}
        </ul>
      )}
      <div className="chips" style={{ marginTop: 10 }}>
        {selected.map((iso) => (
          <span key={iso} className="chip on" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {name(iso)}
            <button type="button" aria-label={`${locale === 'es' ? 'Quitar' : 'Remove'} ${name(iso)}`} onClick={() => onChange(selected.filter((x) => x !== iso))} style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer', minWidth: 28, minHeight: 28 }}>×</button>
          </span>
        ))}
      </div>
    </div>
  );
}
