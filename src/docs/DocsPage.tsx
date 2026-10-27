import { useMemo, useState } from 'react';
import Fuse from 'fuse.js';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import DocView from './DocView';
import DocTree from './DocTree';
import { docHash, HOME_DOC, useContentIndex } from './content';

interface DocsPageProps {
  path: string;
  anchor?: string;
}

const MAX_RESULTS = 60;

export default function DocsPage({ path, anchor }: DocsPageProps) {
  const index = useContentIndex();
  const [query, setQuery] = useState('');

  const fuse = useMemo(
    () => (index ? new Fuse(index.docs, { keys: ['title', 'path'], threshold: 0.35, ignoreLocation: true }) : null),
    [index]
  );
  const results = useMemo(
    () => (fuse && query.trim() ? fuse.search(query.trim(), { limit: MAX_RESULTS }).map((r) => r.item) : []),
    [fuse, query]
  );

  if (!index) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <Box
        sx={{
          width: 300,
          flexShrink: 0,
          borderRight: 1,
          borderColor: 'divider',
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          bgcolor: 'background.default',
        }}
      >
        <Box sx={{ p: 1.5 }}>
          <TextField
            size="small"
            fullWidth
            placeholder={`搜索 ${index.docs.length} 篇文章与 wiki 页面`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Box>
        <List dense sx={{ overflow: 'auto', flex: 1, pt: 0 }}>
          <ListItemButton component="a" href={docHash(HOME_DOC)} selected={path === HOME_DOC}>
            <ListItemText primary="README · 文章导航" slotProps={{ primary: { sx: { fontWeight: 600 } } }} />
          </ListItemButton>
          {!query.trim() && <DocTree docs={index.docs} current={path} />}
          {results.map((d) => (
            <ListItemButton key={d.path} component="a" href={docHash(d.path)} selected={d.path === path}>
              <ListItemText primary={d.title} secondary={d.path.split('/').slice(0, -1).join('/')} />
            </ListItemButton>
          ))}
          {query.trim() && results.length === 0 && (
            <Typography variant="body2" sx={{ px: 2, py: 1, color: 'text.secondary' }}>无匹配结果</Typography>
          )}
        </List>
        <Typography variant="caption" sx={{ px: 2, py: 1, color: 'text.secondary' }}>
          内容同步于 {index.generatedAt.slice(0, 10)}
          {index.sourceCommit && ` · mindforge@${index.sourceCommit}`}
        </Typography>
      </Box>
      <DocView index={index} path={path} anchor={anchor} />
    </Box>
  );
}
