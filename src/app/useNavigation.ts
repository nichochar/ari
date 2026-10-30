import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { appStorage } from '../storage';
export type View = 'desk' | 'path' | 'journal' | 'settings' | 'chat' | 'assessments';
export const labels: Record<View, string> = {
  desk: 'Study desk', path: 'Learning path', journal: 'Journal', settings: 'Settings', chat: 'Talk with Ari', assessments: 'Assessments',
};
const sidebarKey = 'ari:sidebarCollapsed';
const viewKey = 'ari:view';
export function useNavigation() {
  const [view, setView] = useState<View>(() => {
    const saved = appStorage.getItem(viewKey);
    return saved && Object.hasOwn(labels, saved) ? saved as View : 'desk';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => appStorage.getItem(sidebarKey) === 'true');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [chatFocusId, setChatFocusId] = useState(() => appStorage.getItem('ari:chatFocus') || '');
  const [chatStarter, setChatStarter] = useState('');
  const onboardingNavigationChecked = useRef(false);
  useEffect(() => { appStorage.setItem(sidebarKey, String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => { appStorage.setItem(viewKey, view); }, [view]);
  useLayoutEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [view]);
  useEffect(() => { appStorage.setItem('ari:chatFocus', chatFocusId); }, [chatFocusId]);
  return { view, setView, sidebarCollapsed, setSidebarCollapsed, mobileMenu, setMobileMenu,
    chatFocusId, setChatFocusId, chatStarter, setChatStarter, onboardingNavigationChecked };
}
export type Navigation = ReturnType<typeof useNavigation>;
