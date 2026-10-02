import {useEffect, useRef, useState} from 'react';
import {Maximize, Minimize, X} from 'lucide-react';
import {isFullscreen, isStandalone, toggleFullscreen} from '../../shared/browser-fullscreen.ts';
import './fullscreen.css';

export function FullscreenControl({onOverlayChange}: {onOverlayChange?: (open: boolean) => void}) {
  const [fullscreen, setFullscreen] = useState(() => isFullscreen(document));
  const [standalone, setStandalone] = useState(() => isStandalone(window) && !isFullscreen(document));
  const [helpOpen, setHelpOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const overlayCallback = useRef(onOverlayChange);
  overlayCallback.current = onOverlayChange;

  useEffect(() => {
    const update = () => {
      const active = isFullscreen(document);
      setFullscreen(active);
      // Native element fullscreen also matches this media query; keep its exit button.
      const installed = isStandalone(window) && !active;
      setStandalone(installed);
      if (installed) setHelpOpen(false);
    };
    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const fullscreenQuery = window.matchMedia('(display-mode: fullscreen)');
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    const error = () => {setPending(false); setHelpOpen(true);};
    document.addEventListener('fullscreenerror', error);
    document.addEventListener('webkitfullscreenerror', error);
    standaloneQuery.addEventListener('change', update);
    fullscreenQuery.addEventListener('change', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
      document.removeEventListener('fullscreenerror', error);
      document.removeEventListener('webkitfullscreenerror', error);
      standaloneQuery.removeEventListener('change', update);
      fullscreenQuery.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    if (!helpOpen) return;
    const element = dialog.current;
    overlayCallback.current?.(true);
    element?.showModal();
    return () => {
      element?.close();
      overlayCallback.current?.(false);
    };
  }, [helpOpen]);

  const toggle = () => {
    // Start synchronously inside this user gesture, before any await/render work.
    const request = toggleFullscreen(document);
    setPending(true);
    void request.then(result => {
      setPending(false);
      setFullscreen(isFullscreen(document));
      if (result === 'unavailable') setHelpOpen(true);
    });
  };

  if (standalone) return null;
  return <>
    <button type="button" className="icon-button mobile-fullscreen-button" disabled={pending}
      aria-label={fullscreen ? '退出全屏' : '进入全屏'} title={fullscreen ? '退出全屏' : '进入全屏'}
      aria-pressed={fullscreen} onClick={toggle}>
      {fullscreen ? <Minimize size={18}/> : <Maximize size={18}/>}
    </button>
    <dialog ref={dialog} className="fullscreen-guide" aria-labelledby="fullscreen-guide-title" aria-describedby="fullscreen-guide-description"
      onCancel={event => {event.preventDefault(); setHelpOpen(false);}}
      onClose={() => setHelpOpen(false)} onClick={event => {if (event.target === event.currentTarget) setHelpOpen(false);}}>
      <div className="fullscreen-guide-content">
        <header><h2 id="fullscreen-guide-title">给小屋更多空间</h2><button type="button" className="icon-button" aria-label="关闭全屏说明" onClick={() => setHelpOpen(false)} autoFocus><X size={19}/></button></header>
        <p id="fullscreen-guide-description">当前浏览器未能进入全屏，可以这样打开：</p>
        <div className="fullscreen-guide-step"><strong>iPhone / iPad</strong><p>用 Safari 打开 → 分享 → 添加到主屏幕，再从桌面图标进入。若看到「作为网页 App 打开」，请保持开启。</p></div>
        <div className="fullscreen-guide-step"><strong>安卓手机</strong><p>在系统浏览器或 Chrome 中打开，再点全屏；也可从浏览器菜单添加到主屏幕。</p></div>
        <p className="fullscreen-guide-note">微信等内置浏览器可先点右上角菜单，在浏览器中打开。</p>
        <button type="button" className="primary-button fullscreen-guide-confirm" onClick={() => setHelpOpen(false)}>知道了</button>
      </div>
    </dialog>
  </>;
}
