// Browser contracts: https://fullscreen.spec.whatwg.org/
// Home Screen fallback: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
// User instructions: https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios
export interface FullscreenDocument {
  documentElement: {
    requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => Promise<void> | void;
}
export interface StandaloneWindow {
  navigator: object;
  matchMedia: (query: string) => {matches: boolean};
}

export function isFullscreen(doc: FullscreenDocument): boolean {
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

export function isStandalone(win: StandaloneWindow): boolean {
  return (win.navigator as {standalone?: boolean}).standalone === true ||
    win.matchMedia('(display-mode: standalone)').matches || win.matchMedia('(display-mode: fullscreen)').matches;
}

/** Call directly from a click handler: waiting first can consume the browser's user activation. */
export async function toggleFullscreen(doc: FullscreenDocument): Promise<'entered' | 'exited' | 'unavailable'> {
  try {
    if (isFullscreen(doc)) {
      const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      if (!exit) return 'unavailable';
      await exit.call(doc);
      return 'exited';
    }
    const element = doc.documentElement;
    if (element.requestFullscreen && doc.fullscreenEnabled !== false) {
      await element.requestFullscreen({navigationUI: 'hide'});
      return 'entered';
    }
    if (element.webkitRequestFullscreen && doc.webkitFullscreenEnabled !== false) {
      await element.webkitRequestFullscreen();
      return 'entered';
    }
  } catch {
    // In-app browsers and some iPhones expose an API that still rejects the request.
  }
  return 'unavailable';
}
