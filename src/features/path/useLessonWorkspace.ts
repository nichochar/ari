import { useRef, useState } from 'react';
import { appStorage } from '../../storage';

import type { LessonTab } from '../../app/routes';
export type { LessonTab } from '../../app/routes';
export type ChatPosition = { top: number; following: boolean };

export function useLessonWorkspace(tab: LessonTab, onTab: (tab: LessonTab) => void) {
  const [chatOpen, setChatOpen] = useState(() => appStorage.getItem('ari:path:chatOpen') !== 'false');
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(() => {
    const saved = Number(appStorage.getItem('ari:path:chatWidth'));
    return Number.isFinite(saved) && saved >= 15 && saved <= 60 ? saved : 36;
  });
  const scrolls = useRef<Record<string, number>>({});
  const chats = useRef<Record<string, ChatPosition>>({});
  function setOpen(value: boolean) {
    setChatOpen(value); appStorage.setItem('ari:path:chatOpen', String(value));
  }
  function setWidth(value: number) {
    if (!Number.isFinite(value) || value < 15 || value > 60) return;
    setChatWidth(value); appStorage.setItem('ari:path:chatWidth', String(value));
  }
  function setTab(tab: LessonTab) {
    onTab(tab); setMobileChatOpen(false);
  }
  function chatPosition(id: string) {
    return chats.current[id] ??= { top: 0, following: true };
  }
  return { chatOpen, setChatOpen: setOpen, mobileChatOpen, setMobileChatOpen, chatWidth, setChatWidth: setWidth,
    tab, setTab, scrolls, chatPosition };
}
export type LessonWorkspaceState = ReturnType<typeof useLessonWorkspace>;
