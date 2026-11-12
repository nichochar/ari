import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { appStorage } from '../storage';
import { labels, readRoute, sectionPaths, withPreview, withoutPreview, type View } from './routes';
export { labels, type View } from './routes';

export function useNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const route = readRoute(location.pathname, location.search);
  const savedView = appStorage.getItem('ari:view');
  const view = route.view ?? (savedView && Object.hasOwn(labels, savedView) ? savedView as View : 'desk');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => appStorage.getItem('ari:sidebarCollapsed') === 'true');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [chatStarter, setChatStarter] = useState('');
  const initialHome = useRef(route.home);
  useEffect(() => { appStorage.setItem('ari:sidebarCollapsed', String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => { setMobileMenu(false); }, [location.key]);

  function go(destination: string, replace = false) {
    const to = withPreview(destination, location.search);
    if (to !== location.pathname + location.search + location.hash) void navigate(to, { replace });
  }
  function sectionHref(section: View) {
    if (route.found && route.view === section) return withoutPreview(location.pathname, location.search);
    const saved = appStorage.getItem('ari:route:' + section);
    if (saved?.startsWith('/') && !saved.startsWith('//')) {
      const url = new URL(saved, 'http://ari.local');
      if (readRoute(url.pathname, url.search).view === section) return saved;
    }
    return sectionPaths[section];
  }
  function remember() {
    if (!route.view) return;
    appStorage.setItem('ari:view', route.view);
    appStorage.setItem('ari:route:' + route.view, withoutPreview(location.pathname, location.search));
  }
  function setChatFocusId(id: string) {
    const query = new URLSearchParams();
    if (id) query.set('focus', id);
    go('/chat' + (query.size ? '?' + query : ''), true);
    appStorage.setItem('ari:chatFocus', id);
  }
  return { location, route, view, go, sectionHref, remember, initialHome,
    sidebarCollapsed, setSidebarCollapsed, mobileMenu, setMobileMenu,
    chatFocusId: route.focusId, setChatFocusId, chatStarter, setChatStarter };
}
export type Navigation = ReturnType<typeof useNavigation>;
