import type { ReactNode } from 'react';
import { BookOpen, CheckCircle2, ClipboardCheck, History, Menu, Settings2, Target } from 'lucide-react';
import { Button } from '../components/ui/button';
import { AriIcon, AriMark, AriWordmark } from '../components/ui/ari-mark';
import { labels, type Navigation, type View } from './useNavigation';
function navIcon(view: View) {
  if (view === 'desk') return <BookOpen size={19} />;
  if (view === 'chat') return <AriIcon size={19} />;
  if (view === 'path') return <Target size={19} />;
  if (view === 'journal') return <History size={19} />;
  if (view === 'assessments') return <ClipboardCheck size={19} />;
  return <Settings2 size={19} />;
}

type AppShellProps = {
  navigation: Navigation; learnerName: string; completedCount: number; unreadCount: number;
  onNavigate: (view: View) => void; children: ReactNode; overlays: ReactNode;
};
export function AppShell({ navigation, learnerName, completedCount, unreadCount, onNavigate, children, overlays }: AppShellProps) {
  const { view, sidebarCollapsed, setSidebarCollapsed, mobileMenu, setMobileMenu } = navigation;
  return <div className={'app-shell ' + (sidebarCollapsed ? 'sidebar-collapsed' : '')}>
    <aside className={'sidebar ' + (mobileMenu ? 'sidebar-open' : '')}>
      <div className="brand"><AriWordmark className="brand-wordmark" height={34} /><AriMark className="brand-mark" size={42} label="Ari" /></div>
      <Button variant="plain" className="collapse-button" onClick={() => setSidebarCollapsed(value => !value)}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}><Menu size={19} /></Button>
      <nav className="main-nav" aria-label="Main navigation">
        {(['desk', 'chat', 'path', 'assessments', 'journal', 'settings'] as View[]).map(item =>
          <Button variant="plain" key={item} title={labels[item]} aria-label={labels[item] + ((item === 'chat' || item === 'path') && unreadCount ? ', unread message' : '')} aria-current={view === item ? 'page' : undefined}
            className={'nav-item ' + (view === item ? 'active' : '')}
            onClick={() => { onNavigate(item); }}>
            {navIcon(item)}<span>{labels[item]}</span>{(item === 'chat' || item === 'path') && !!unreadCount && <><i className="unread-dot" aria-hidden="true" /><span className="sr-only">Unread message</span></>}
          </Button>,
        )}
      </nav>
      <div className="sidebar-foot">
        <span className="learner-name">{learnerName && learnerName !== 'Learner' ? learnerName : 'Your learning'}</span>
        <span className="completion-count"><CheckCircle2 size={13} aria-hidden="true" />
          <span><strong>{completedCount}</strong> {completedCount === 1 ? 'exercise' : 'exercises'} completed</span>
        </span>
      </div>
    </aside>
    {mobileMenu && <Button variant="plain" className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileMenu(false)} />}
    <main className="main-area">
      <Button variant="plain" className="mobile-menu" aria-label="Open menu" onClick={() => setMobileMenu(true)}><Menu size={22} /></Button>
      {children}
    </main>
    {overlays}
  </div>;
}
