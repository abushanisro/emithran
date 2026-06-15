'use client';

/**
 * EchoProvider — global UI state for the Echo widget.
 *
 * Tracks: open/closed, active conversation, panel width, button position. All
 * state is local-first so it survives reloads and feels instant. Server state
 * (conversation list, alerts) lives in react-query.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const STORAGE_KEY = 'echo:ui-state:v1';

interface EchoUiState {
  isOpen: boolean;
  panelWidth: number;
  buttonPos: { x: number; y: number };
  activeConversationId: string | null;
  activeTab: 'chat' | 'suggestions' | 'alerts' | 'history';
}

const DEFAULT_STATE: EchoUiState = {
  isOpen: false,
  panelWidth: 420,
  buttonPos: { x: 24, y: 24 },
  activeConversationId: null,
  activeTab: 'chat',
};

interface EchoCtxValue extends EchoUiState {
  open: () => void;
  close: () => void;
  toggle: () => void;
  setPanelWidth: (w: number) => void;
  setButtonPos: (p: { x: number; y: number }) => void;
  setActiveConversation: (id: string | null) => void;
  setActiveTab: (t: EchoUiState['activeTab']) => void;
  startNewConversation: () => void;
  /** Open with a pre-filled topic — used by EchoHintButton. */
  openWithTopic: (topicId: string) => void;
  pendingTopicId: string | null;
  consumePendingTopic: () => string | null;
}

const EchoCtx = createContext<EchoCtxValue | null>(null);

function loadState(): EchoUiState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<EchoUiState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      // Always start closed — opening should be intentional after reload.
      isOpen: false,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function persist(state: EchoUiState) {
  if (typeof window === 'undefined') return;
  try {
    const { isOpen: _isOpen, activeConversationId: _id, ...rest } = state;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch {
    // ignore quota / serialization errors
  }
}

export function EchoProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EchoUiState>(DEFAULT_STATE);
  const [pendingTopicId, setPendingTopicId] = useState<string | null>(null);

  // Hydrate from localStorage after mount (avoids hydration mismatch).
  useEffect(() => {
    setState(loadState());
  }, []);

  useEffect(() => {
    persist(state);
  }, [state]);

  const open = useCallback(() => { setState((s) => ({ ...s, isOpen: true })); }, []);
  const close = useCallback(() => { setState((s) => ({ ...s, isOpen: false })); }, []);
  const toggle = useCallback(() => { setState((s) => ({ ...s, isOpen: !s.isOpen })); }, []);
  const setPanelWidth = useCallback(
    (panelWidth: number) =>
      { setState((s) => ({ ...s, panelWidth: Math.min(720, Math.max(320, panelWidth)) })); },
    [],
  );
  const setButtonPos = useCallback(
    (buttonPos: { x: number; y: number }) => { setState((s) => ({ ...s, buttonPos })); },
    [],
  );
  const setActiveConversation = useCallback(
    (activeConversationId: string | null) =>
      { setState((s) => ({ ...s, activeConversationId, activeTab: 'chat' })); },
    [],
  );
  const setActiveTab = useCallback(
    (activeTab: EchoUiState['activeTab']) =>
      { setState((s) => ({ ...s, activeTab, isOpen: true })); },
    [],
  );
  const startNewConversation = useCallback(
    () => { setState((s) => ({ ...s, activeConversationId: null, activeTab: 'chat', isOpen: true })); },
    [],
  );
  const openWithTopic = useCallback((topicId: string) => {
    setPendingTopicId(topicId);
    setState((s) => ({ ...s, isOpen: true, activeTab: 'chat', activeConversationId: null }));
  }, []);
  const consumePendingTopic = useCallback(() => {
    if (!pendingTopicId) return null;
    const v = pendingTopicId;
    setPendingTopicId(null);
    return v;
  }, [pendingTopicId]);

  const value = useMemo<EchoCtxValue>(
    () => ({
      ...state,
      open,
      close,
      toggle,
      setPanelWidth,
      setButtonPos,
      setActiveConversation,
      setActiveTab,
      startNewConversation,
      openWithTopic,
      pendingTopicId,
      consumePendingTopic,
    }),
    [
      state,
      open,
      close,
      toggle,
      setPanelWidth,
      setButtonPos,
      setActiveConversation,
      setActiveTab,
      startNewConversation,
      openWithTopic,
      pendingTopicId,
      consumePendingTopic,
    ],
  );

  return <EchoCtx.Provider value={value}>{children}</EchoCtx.Provider>;
}

export function useEchoUi(): EchoCtxValue {
  const v = useContext(EchoCtx);
  if (!v) throw new Error('useEchoUi must be used inside <EchoProvider>');
  return v;
}
