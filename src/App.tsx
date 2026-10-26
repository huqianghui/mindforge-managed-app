import { useEffect, useState } from 'react';
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
import './docs/markdown.css';

type Route = { view: 'graph' } | { view: 'doc'; path: string; anchor?: string };

// hash 路由：宿主以 iframe 加载应用，hash 不依赖服务端的路径回退规则
function parseHash(hash: string): Route {
  if (hash.startsWith('#/graph')) return { view: 'graph' };
  const m = hash.match(/^#\/doc\/([^?]+)(?:\?a=(.*))?$/);
  if (m) return { view: 'doc', path: decodeURIComponent(m[1]), anchor: m[2] ? decodeURIComponent(m[2]) : undefined };
  return { view: 'doc', path: HOME_DOC };
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

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
          </Tabs>
        </Box>
        {route.view === 'graph' ? <GraphPage /> : <DocsPage path={route.path} anchor={route.anchor} />}
      </Box>
    </ThemeProvider>
  );
}
