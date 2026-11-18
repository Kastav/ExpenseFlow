import { useEffect, useRef, useState } from 'react';

type BackHandlerFn = () => boolean | void;

interface BackLayerEntry {
  id: number;
  handler: BackHandlerFn;
}

const modalStack: BackLayerEntry[] = [];
let nextLayerId = 1;
let rootBackFallback: BackHandlerFn | null = null;

/**
 * Registers an app-level fallback back handler (used for sub-views & tab history)
 * when no modal/sheet overlay is open.
 */
export function setRootBackHandler(handler: BackHandlerFn | null): void {
  rootBackFallback = handler;
}

/**
 * Invoked by Android native OnBackPressedCallback or Web popstate handler.
 * Returns true if the back press was consumed by closing an overlay or navigating back.
 */
export function dispatchExpenseFlowBack(): boolean {
  if (modalStack.length > 0) {
    const top = modalStack[modalStack.length - 1];
    const result = top.handler();
    return result !== false;
  }

  if (rootBackFallback) {
    return Boolean(rootBackFallback());
  }

  return false;
}

/**
 * Registers a modal/sheet/dialog into a strict LIFO back stack so Android hardware Back
 * always dismisses the top-most open overlay before navigating tabs or exiting.
 */
export function useModalBackHandler(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const id = nextLayerId++;
    const entry: BackLayerEntry = {
      id,
      handler: () => {
        onCloseRef.current();
        return true;
      },
    };
    modalStack.push(entry);

    return () => {
      const idx = modalStack.findIndex((item) => item.id === id);
      if (idx !== -1) {
        modalStack.splice(idx, 1);
      }
    };
  }, [isOpen]);
}

export function getActiveModalStackDepth(): number {
  return modalStack.length;
}

/**
 * Smoothly scrolls focused form inputs into view on mobile keyboards.
 */
export function scrollInputIntoViewOnFocus(e: React.FocusEvent<HTMLElement>): void {
  const target = e.currentTarget;
  if (typeof window === 'undefined' || !target) return;
  if (window.innerWidth >= 768) return;

  window.setTimeout(() => {
    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      // Safe ignore
    }
  }, 180);
}

/**
 * Detects whether a virtual keyboard or active mobile text field is open on narrow screens
 * so fixed bottom navigation can step aside and preserve typing area.
 */
export function useMobileKeyboardVisible(): boolean {
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const isEditableElement = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === 'textarea') return true;
      if (tag === 'input') {
        const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
        return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color'].includes(type);
      }
      return false;
    };

    const baselineHeightRef = { current: window.innerHeight };

    const evaluate = () => {
      const isNarrow = window.innerWidth < 768;
      if (!isNarrow) {
        setKeyboardVisible(false);
        return;
      }

      const vv = window.visualViewport;
      const heightShrink = vv ? baselineHeightRef.current - vv.height > 140 : false;
      const activeIsInput = isEditableElement(document.activeElement);
      setKeyboardVisible(heightShrink || activeIsInput);
    };

    const handleFocusIn = () => {
      baselineHeightRef.current = Math.max(baselineHeightRef.current, window.innerHeight);
      evaluate();
    };
    const handleFocusOut = () => {
      window.setTimeout(evaluate, 120);
    };
    const handleViewportResize = () => {
      if (window.innerHeight > baselineHeightRef.current) {
        baselineHeightRef.current = window.innerHeight;
      }
      evaluate();
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    window.visualViewport?.addEventListener('resize', handleViewportResize);
    window.addEventListener('resize', handleViewportResize);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
      window.removeEventListener('resize', handleViewportResize);
    };
  }, []);

  return keyboardVisible;
}
