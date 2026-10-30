import React, { useEffect, useId, useState } from 'react';

export function NumericInput({ value, onChange, min = -Infinity, max = Infinity, integer = false, ...props }) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  const normalize = n => Math.min(max, Math.max(min, integer ? Math.round(n) : n));
  return <input {...props} type="number" value={draft}
    min={Number.isFinite(min) ? min : undefined} max={Number.isFinite(max) ? max : undefined}
    onFocus={() => setEditing(true)}
    onChange={event => {
      const text = event.target.value;
      setDraft(text);
      if (!text.trim() || text.endsWith('.')) return;
      const number = Number(text);
      if (Number.isFinite(number) && number >= min && number <= max && (!integer || Number.isInteger(number))) onChange(number);
    }}
    onBlur={() => {
      setEditing(false);
      const number = Number(draft);
      if (!draft.trim() || !Number.isFinite(number)) { setDraft(String(value)); return; }
      const normalized = normalize(number);
      setDraft(String(normalized));
      onChange(normalized);
    }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />;
}

export function Slider({ label, value, min, max, step, onChange, suffix = '' }) {
  const id = useId();
  return <div className="slider-row">
    <div className="slider-head">
      <label id={`${id}-label`} htmlFor={id}>{label}</label>
      <div className="val-input">
        <NumericInput id={id} className="mono" value={value} min={min} max={max} step={step} onChange={onChange} />
        {suffix && <span className="val-suffix mono">{suffix}</span>}
      </div>
    </div>
    <input type="range" aria-labelledby={`${id}-label`} min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
  </div>;
}

export function NumField({ label, value, step = 1, onChange, ...bounds }) {
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label>
    <NumericInput id={id} className="num mono" value={value} step={step} onChange={onChange} {...bounds} />
  </div>;
}

export function TextField({ label, value, onChange, placeholder = '', wide = false, maxLength }) {
  const id = useId();
  return <div className={'field' + (wide ? ' field-wide' : '')}>
    <label htmlFor={id}>{label}</label>
    <input id={id} className="num text mono" type="text" value={value} maxLength={maxLength}
      placeholder={placeholder} onChange={event => onChange(event.target.value)} />
  </div>;
}

export function Seg({ options, value, onChange, icon = false }) {
  return <div className={'seg' + (icon ? ' icon' : '')}>
    {options.map(option => <button key={option.value} aria-pressed={value === option.value}
      aria-label={option.title || option.label} className={value === option.value ? 'on' : ''}
      onClick={() => onChange(option.value)} title={option.title || option.label}>
      {option.render ? option.render(value === option.value) : option.label}
    </button>)}
  </div>;
}

export function Toggle({ label, checked, onChange }) {
  return <input className="toggle" type="checkbox" role="switch" aria-label={label}
    checked={checked} onChange={event => onChange(event.target.checked)} />;
}
