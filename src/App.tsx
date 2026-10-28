import { lazy, Suspense, useEffect, useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';
import { theme } from './theme';
import GraphPage from './GraphPage';
import DocsPage from './docs/DocsPage';
import { HOME_DOC } from './docs/content';
import { useUser } from './platform/user';
import './docs/markdown.css';

// 图表库只在洞察页和演进页用到，单独拆包
const TimelinePage = lazy(() => import('./timeline/TimelinePage'));
const InsightsPage = lazy(() => import('./insights/InsightsPage'));
const GapsPage = lazy(() => import('./gaps/GapsPage'));
const SuggestionsPage = lazy(() => import('./suggestions/SuggestionsPage'));
const StatsPage = lazy(() => import('./stats/StatsPage'));
const AskPage = lazy(() => import('./ask/AskPage'));

type Route =
  | { view: 'graph' }
  | { view: 'insights' }
  | { view: 'gaps' }
  | { view: 'suggestions' }
  | { view: 'stats' }
  | { view: 'ask'; q?: string; doc?: string }
  | { view: 'timeline' }
  | { view: 'doc'; path: string; anchor?: string };

// hash 路由：宿主以 iframe 加载应用，hash 不依赖服务端的路径回退规则
function parseHash(hash: string): Route {
  if (hash.startsWith('#/graph')) return { view: 'graph' };
  if (hash.startsWith('#/insights')) return { view: 'insights' };
  if (hash.startsWith('#/gaps')) return { view: 'gaps' };
  if (hash.startsWith('#/suggestions')) return { view: 'suggestions' };
  if (hash.startsWith('#/stats')) return { view: 'stats' };
  if (hash.startsWith('#/ask')) {
    const qs = new URLSearchParams(hash.split('?')[1] ?? '');
    return { view: 'ask', q: qs.get('q') ?? undefined, doc: qs.get('doc') ?? undefined };
  }
  if (hash.startsWith('#/timeline')) return { view: 'timeline' };
  const m = hash.match(/^#\/doc\/([^?]+)(?:\?a=(.*))?$/);
  if (m) return { view: 'doc', path: decodeURIComponent(m[1]), anchor: m[2] ? decodeURIComponent(m[2]) : undefined };
  return { view: 'doc', path: HOME_DOC };
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const user = useUser();

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, borderBottom: 1, borderColor: 'divider', bgcolor: '#fff' }}>
          <Typography sx={{ fontWeight: 700, mr: 3 }}>Mindforge</Typography>
          <Tabs value={route.view} sx={{ minHeight: 44, '& .MuiTab-root': { minHeight: 44 } }}>
            <Tab value="doc" label="文章导航" component="a" href={`#/doc/${HOME_DOC}`} />
            <Tab value="graph" label="知识图谱" component="a" href="#/graph" />
            <Tab value="insights" label="洞察" component="a" href="#/insights" />
            <Tab value="gaps" label="差距追踪" component="a" href="#/gaps" />
            <Tab value="suggestions" label="建议" component="a" href="#/suggestions" />
            <Tab value="stats" label="统计" component="a" href="#/stats" />
            <Tab value="timeline" label="演进" component="a" href="#/timeline" />
            <Tab value="ask" label="问答" component="a" href="#/ask" />
          </Tabs>
          {user && (
            <Typography variant="body2" sx={{ ml: 'auto', color: 'text.secondary' }}>{user.fullName}</Typography>
          )}
        </Box>
        {route.view === 'graph' && <GraphPage />}
        {route.view === 'insights' && (
          <Suspense fallback={null}>
            <InsightsPage />
          </Suspense>
        )}
        {route.view === 'gaps' && (
          <Suspense fallback={null}>
            <GapsPage />
          </Suspense>
        )}
        {route.view === 'ask' && (
          <Suspense fallback={null}>
            <AskPage key={`${route.q}|${route.doc}`} initialQuestion={route.q} pinned={route.doc} />
          </Suspense>
        )}
        {route.view === 'stats' && (
          <Suspense fallback={null}>
            <StatsPage />
          </Suspense>
        )}
        {route.view === 'suggestions' && (
          <Suspense fallback={null}>
            <SuggestionsPage />
          </Suspense>
        )}
        {route.view === 'timeline' && (
          <Suspense fallback={null}>
            <TimelinePage />
          </Suspense>
        )}
        {route.view === 'doc' && <DocsPage path={route.path} anchor={route.anchor} />}
      </Box>
    </ThemeProvider>
  );
}
