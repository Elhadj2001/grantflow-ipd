/// <reference types="jest" />
import '@testing-library/jest-dom';

// Stubs minimaux pour Next.js / navigator dans jsdom
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// Polyfills nécessaires aux primitives Radix (Popover, Tooltip…) +
// cmdk qui mesurent la taille du contenu via ResizeObserver. jsdom
// n'expose ni ResizeObserver ni hasPointerCapture/scrollIntoView.
if (typeof window !== 'undefined') {
  if (!('ResizeObserver' in window)) {
    // @ts-expect-error — polyfill no-op suffisant pour les tests
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
}
