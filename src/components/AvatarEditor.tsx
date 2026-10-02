import { useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Check, CircleSlash, Glasses, Headphones, Heart, Pipette, Scissors, Shirt, Smile, Sparkles } from 'lucide-react';
import type { AvatarConfig } from '../../shared/protocol';
import './avatar-editor.css';

type AvatarEditorProps = {
  config: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
};

type ColorOption = { color: string; label: string };
type Tab = 'face' | 'hair' | 'outfit';

const SKIN_COLORS: ColorOption[] = [
  { color: '#ffe5cf', label: '奶杏' },
  { color: '#f4c7a1', label: '蜜桃' },
  { color: '#e9ad83', label: '暖沙' },
  { color: '#cb8f67', label: '焦糖' },
  { color: '#aa6e4e', label: '栗子' },
  { color: '#82543e', label: '可可' },
  { color: '#573b31', label: '浓巧' },
];

const HAIR_COLORS: ColorOption[] = [
  { color: '#513d37', label: '栗棕' },
  { color: '#282835', label: '夜黑' },
  { color: '#bf8650', label: '奶茶' },
  { color: '#e6c588', label: '浅金' },
  { color: '#a08ac7', label: '香芋' },
  { color: '#e7a2a7', label: '莓粉' },
];

const CLOTHING_COLORS: ColorOption[] = [
  { color: '#bfa9ed', label: '软紫' },
  { color: '#e9a9b4', label: '桃粉' },
  { color: '#f1cf86', label: '奶黄' },
  { color: '#9ac7b3', label: '鼠尾草' },
  { color: '#94b9df', label: '晴蓝' },
  { color: '#f4ede0', label: '奶白' },
];

const PANTS_COLORS: ColorOption[] = [
  { color: '#546574', label: '雾蓝' },
  { color: '#78688a', label: '灰紫' },
  { color: '#a68b73', label: '燕麦棕' },
  { color: '#78917f', label: '苔绿' },
  { color: '#343743', label: '炭灰' },
  { color: '#e9dece', label: '米白' },
];

const TABS = [
  { id: 'face', label: '脸蛋', icon: Smile },
  { id: 'hair', label: '发型', icon: Scissors },
  { id: 'outfit', label: '穿搭', icon: Shirt },
] as const;

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <fieldset className="avatar-editor__section">
      <legend className="avatar-editor__section-title">{title}</legend>
      {note && <p className="avatar-editor__section-note">{note}</p>}
      {children}
    </fieldset>
  );
}

function ColorPicker({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: ColorOption[];
  onChange: (value: string) => void;
}) {
  const customId = useId();
  const customSelected = !options.some(({ color }) => color.toLowerCase() === value.toLowerCase());

  return (
    <div className="avatar-editor__colors">
      <div className="avatar-editor__swatches" role="group" aria-label={`${label}预设`}>
        {options.map(({ color, label: colorName }) => {
          const selected = color.toLowerCase() === value.toLowerCase();
          return (
            <button
              type="button"
              key={color}
              className="avatar-editor__swatch"
              style={{ '--swatch-color': color } as CSSProperties}
              onClick={() => onChange(color)}
              aria-label={`${label}：${colorName}`}
              title={`${label}：${colorName}`}
              aria-pressed={selected}
            >
              <span className="avatar-editor__swatch-fill" />
              {selected && <span className="avatar-editor__swatch-check"><Check size={12} strokeWidth={3} aria-hidden="true" /></span>}
            </button>
          );
        })}
      </div>
      <label className={`avatar-editor__custom-color${customSelected ? ' is-selected' : ''}`} htmlFor={customId} title={`自选${label}`}>
        <span className="avatar-editor__custom-color-icon" style={{ '--custom-color': value } as CSSProperties}>
          <Pipette size={14} aria-hidden="true" />
        </span>
        <span>自选</span>
        <input id={customId} type="color" value={value} onChange={(event) => onChange(event.target.value)} aria-label={`自选${label}`} title={`自选${label}`} />
      </label>
    </div>
  );
}

function RangeControl({ label, value, min, max, lowLabel, highLabel, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  lowLabel: string;
  highLabel: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const percent = Math.round(value * 100);
  const fill = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  return (
    <div className="avatar-editor__range-group">
      <div className="avatar-editor__range-heading">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{percent}<span>%</span></output>
      </div>
      <input
        id={id}
        className="avatar-editor__range"
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ '--range-fill': `${fill}%` } as CSSProperties}
        aria-valuetext={`${percent}%`}
        title={label}
      />
      <div className="avatar-editor__range-labels" aria-hidden="true"><span>{lowLabel}</span><span>{highLabel}</span></div>
    </div>
  );
}

function HairThumbnail({ style, color }: { style: AvatarConfig['hairStyle']; color: string }) {
  return (
    <svg viewBox="0 0 72 64" fill="none" aria-hidden="true" className="avatar-editor__hair-art">
      {style === 'bob' && <path d="M15 49V28C15 11 23 6 36 6s21 6 21 22v21c-9 8-33 8-42 0Z" fill={color} />}
      {style === 'buns' && <><circle cx="17" cy="18" r="11" fill={color} /><circle cx="55" cy="18" r="11" fill={color} /><path d="M17 33V26a19 19 0 0 1 38 0v7" fill={color} /></>}
      <ellipse cx="36" cy="34" rx="18" ry="21" fill="#f6d4b8" />
      <ellipse cx="28.5" cy="36" rx="2" ry="2.7" fill="#55415f" />
      <ellipse cx="43.5" cy="36" rx="2" ry="2.7" fill="#55415f" />
      <path d="M33 43q3 3 6 0" stroke="#9c665f" strokeWidth="1.8" strokeLinecap="round" />
      {style === 'bob' && <path d="M17 31V26C17 12 24 7 36 7s20 6 20 19v7L47 23l-6 7-5-8-8 8-4-6-7 7Z" fill={color} />}
      {style === 'crop' && <path d="m17 29 1-12 7-1 3-7 9 3 8-3 4 7 7 3-1 14-7-10-6 2-8-4-9 5-8 3Z" fill={color} />}
      {style === 'buns' && <path d="M17 31c-2-16 9-23 20-23s20 9 18 24c-7-1-12-5-17-13-5 8-12 11-21 12Z" fill={color} />}
      {style === 'swoop' && <path d="M17 35c-8-17 5-29 22-28 18 1 20 11 16 25l-8-10c-7 9-18 8-22 17l-1-14-7 10Z" fill={color} />}
      <path d="M24 16c3-4 7-6 12-6" stroke="white" strokeOpacity=".22" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function OutfitThumbnail({ outfit, color }: { outfit: AvatarConfig['outfit']; color: string }) {
  return (
    <svg viewBox="0 0 72 64" fill="none" aria-hidden="true" className="avatar-editor__outfit-art">
      <path d="m24 14-13 8 7 16 8-4v21h21V34l8 4 7-16-14-8-12 5-12-5Z" fill={outfit === 'overalls' ? '#f6e9d2' : color} stroke="#776480" strokeWidth="1.4" strokeLinejoin="round" />
      {outfit === 'hoodie' && <><path d="M25 14c0-8 22-8 22 0l-5 12H30l-5-12Z" fill={color} stroke="#776480" strokeWidth="1.4" /><path d="M32 23v10m9-10v10M29 43h14l3 8H26l3-8Z" stroke="#776480" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></>}
      {outfit === 'tee' && <><path d="M28 16c0 9 16 9 16 0" stroke="#776480" strokeWidth="1.4" /><path d="m36 30 2 4 4 .6-3 3 .7 4.2-3.7-2-3.7 2 .7-4.2-3-3 4-.6 2-4Z" fill="#fff" fillOpacity=".62" /></>}
      {outfit === 'overalls' && <><path d="M25 17h6v16h11V17h6v39H25V17Z" fill={color} stroke="#776480" strokeWidth="1.4" strokeLinejoin="round" /><path d="M31 34v9h11v-9M36.5 48v8" stroke="#776480" strokeWidth="1.4" /><circle cx="28" cy="31" r="1.5" fill="#f7da87" /><circle cx="45" cy="31" r="1.5" fill="#f7da87" /></>}
    </svg>
  );
}

function MouthThumbnail({ mouth }: { mouth: AvatarConfig['mouth'] }) {
  return (
    <svg width="32" height="25" viewBox="0 0 32 25" fill="none" aria-hidden="true">
      <circle cx="8" cy="7" r="1.7" fill="currentColor" /><circle cx="24" cy="7" r="1.7" fill="currentColor" />
      {mouth === 'smile' && <path d="M10 14q6 8 12 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
      {mouth === 'cat' && <path d="M8 14c0 6 8 6 8 0 0 6 8 6 8 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
      {mouth === 'small' && <ellipse cx="16" cy="16" rx="2.6" ry="2" fill="currentColor" />}
    </svg>
  );
}

function BowIcon() {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 10 4 6a1 1 0 0 0-1.5.9v10.2A1 1 0 0 0 4 18l6-4m4-4 6-4a1 1 0 0 1 1.5.9v10.2A1 1 0 0 1 20 18l-6-4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><rect x="9" y="9" width="6" height="6" rx="2" stroke="currentColor" strokeWidth="1.7" /></svg>;
}

export function AvatarEditor({ config, onChange }: AvatarEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>('face');
  const baseId = useId();

  function update<K extends keyof AvatarConfig>(key: K, value: AvatarConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index + TABS.length - 1) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(TABS[nextIndex].id);
    const nextButton = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex];
    nextButton?.focus();
  }

  return (
    <section className="avatar-editor" aria-labelledby={`${baseId}-title`}>
      <header className="avatar-editor__heading">
        <div className="avatar-editor__heading-icon"><Sparkles size={20} strokeWidth={1.7} aria-hidden="true" /></div>
        <div><h2 id={`${baseId}-title`}>把可爱调到刚刚好</h2><p>一点点调整，变成喜欢的模样</p></div>
      </header>

      <div className="avatar-editor__tabs" role="tablist" aria-label="造型类别">
        {TABS.map(({ id, label, icon: Icon }, index) => (
          <button
            type="button"
            id={`${baseId}-tab-${id}`}
            key={id}
            role="tab"
            className="avatar-editor__tab"
            aria-selected={activeTab === id}
            aria-pressed={activeTab === id}
            aria-controls={`${baseId}-panel-${id}`}
            tabIndex={activeTab === id ? 0 : -1}
            title={label}
            onClick={() => setActiveTab(id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          ><Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span></button>
        ))}
      </div>

      <div className="avatar-editor__panel" role="tabpanel" id={`${baseId}-panel-face`} aria-labelledby={`${baseId}-tab-face`} hidden={activeTab !== 'face'}>
        <Section title="肤色" note="每一种颜色，都有自己的可爱">
          <ColorPicker label="肤色" value={config.skin} options={SKIN_COLORS} onChange={(value) => update('skin', value)} />
        </Section>
        <Section title="脸蛋的模样">
          <div className="avatar-editor__ranges">
            <RangeControl label="脸蛋宽度" value={config.faceWidth} min={0.85} max={1.15} lowLabel="秀气一点" highLabel="圆润一点" onChange={(value) => update('faceWidth', value)} />
            <RangeControl label="眼睛大小" value={config.eyeSize} min={0.75} max={1.35} lowLabel="小小的" highLabel="亮晶晶" onChange={(value) => update('eyeSize', value)} />
            <RangeControl label="眼睛间距" value={config.eyeSpacing} min={0.8} max={1.2} lowLabel="靠近一点" highLabel="分开一点" onChange={(value) => update('eyeSpacing', value)} />
          </div>
        </Section>
        <Section title="小表情">
          <div className="avatar-editor__options avatar-editor__options--mouth" role="group" aria-label="嘴型">
            {([{ value: 'smile', label: '甜甜笑' }, { value: 'cat', label: '猫猫嘴' }, { value: 'small', label: '小小嘴' }] as const).map(({ value, label }) => (
              <button type="button" className="avatar-editor__option avatar-editor__mouth-option" key={value} aria-pressed={config.mouth === value} aria-label={`嘴型：${label}`} title={`嘴型：${label}`} onClick={() => update('mouth', value)}>
                <MouthThumbnail mouth={value} /><span>{label}</span>
              </button>
            ))}
          </div>
          <RangeControl label="腮红浓度" value={config.cheek} min={0} max={1} lowLabel="清清淡淡" highLabel="脸红扑扑" onChange={(value) => update('cheek', value)} />
        </Section>
      </div>

      <div className="avatar-editor__panel" role="tabpanel" id={`${baseId}-panel-hair`} aria-labelledby={`${baseId}-tab-hair`} hidden={activeTab !== 'hair'}>
        <Section title="挑一个发型" note="今天也要有一点蓬松的心情">
          <div className="avatar-editor__options avatar-editor__options--hair" role="group" aria-label="发型">
            {([{ value: 'bob', label: '乖乖波波' }, { value: 'crop', label: '清爽短发' }, { value: 'buns', label: '双丸子' }, { value: 'swoop', label: '蓬松侧分' }] as const).map(({ value, label }) => (
              <button type="button" className="avatar-editor__option avatar-editor__art-option" key={value} aria-pressed={config.hairStyle === value} aria-label={`发型：${label}`} title={`发型：${label}`} onClick={() => update('hairStyle', value)}>
                <HairThumbnail style={value} color={config.hairColor} /><span>{label}</span>
                {config.hairStyle === value && <Check className="avatar-editor__selected-mark" size={13} strokeWidth={2.6} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </Section>
        <Section title="发色"><ColorPicker label="发色" value={config.hairColor} options={HAIR_COLORS} onChange={(value) => update('hairColor', value)} /></Section>
        <div className="avatar-editor__little-note"><Scissors size={20} strokeWidth={1.5} aria-hidden="true" /><p>换个发型，<br /><strong>换一种好心情。</strong></p><span className="avatar-editor__note-spark"><Sparkles size={26} strokeWidth={1.2} aria-hidden="true" /></span></div>
      </div>

      <div className="avatar-editor__panel" role="tabpanel" id={`${baseId}-panel-outfit`} aria-labelledby={`${baseId}-tab-outfit`} hidden={activeTab !== 'outfit'}>
        <Section title="今天穿什么">
          <div className="avatar-editor__options avatar-editor__options--outfit" role="group" aria-label="服装款式">
            {([{ value: 'hoodie', label: '软软卫衣' }, { value: 'tee', label: '轻松短袖' }, { value: 'overalls', label: '可爱背带' }] as const).map(({ value, label }) => (
              <button type="button" className="avatar-editor__option avatar-editor__art-option" key={value} aria-pressed={config.outfit === value} aria-label={`穿搭：${label}`} title={`穿搭：${label}`} onClick={() => update('outfit', value)}>
                <OutfitThumbnail outfit={value} color={config.shirtColor} /><span>{label}</span>
                {config.outfit === value && <Check className="avatar-editor__selected-mark" size={13} strokeWidth={2.6} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </Section>
        <Section title="上衣颜色"><ColorPicker label="上衣颜色" value={config.shirtColor} options={CLOTHING_COLORS} onChange={(value) => update('shirtColor', value)} /></Section>
        <Section title="裤子颜色"><ColorPicker label="裤子颜色" value={config.pantsColor} options={PANTS_COLORS} onChange={(value) => update('pantsColor', value)} /></Section>
        <Section title="加一点小心思">
          <div className="avatar-editor__options avatar-editor__options--accessory" role="group" aria-label="配饰">
            {([
              { value: 'none', label: '不佩戴', icon: <CircleSlash size={23} strokeWidth={1.6} aria-hidden="true" /> },
              { value: 'glasses', label: '圆圆眼镜', icon: <Glasses size={25} strokeWidth={1.6} aria-hidden="true" /> },
              { value: 'headphones', label: '音乐耳机', icon: <Headphones size={23} strokeWidth={1.6} aria-hidden="true" /> },
              { value: 'bow', label: '蝴蝶结', icon: <BowIcon /> },
            ] as const).map(({ value, label, icon }) => (
              <button type="button" className="avatar-editor__option avatar-editor__accessory-option" key={value} aria-pressed={config.accessory === value} aria-label={`配饰：${label}`} title={`配饰：${label}`} onClick={() => update('accessory', value)}>{icon}<span>{label}</span></button>
            ))}
          </div>
        </Section>
      </div>

      <p className="avatar-editor__footer"><Heart size={14} strokeWidth={1.7} aria-hidden="true" />随时可以回来换造型</p>
    </section>
  );
}
