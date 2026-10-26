import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import type { WikiNode, WikiGraphStats } from '../types';
import { NODE_COLORS, NODE_TYPE_LABELS, RELATION_COLORS, RELATION_TYPE_LABELS } from '../theme';
import SearchBox from './SearchBox';

interface FilterBarProps {
  stats: WikiGraphStats | null;
  allNodes: WikiNode[];
  activeNodeTypes: Set<string>;
  toggleNodeType: (type: string) => void;
  activeRelationTypes: Set<string>;
  toggleRelationType: (type: string) => void;
  onSearchSelect: (nodeId: string) => void;
}

export default function FilterBar({
  stats,
  allNodes,
  activeNodeTypes,
  toggleNodeType,
  activeRelationTypes,
  toggleRelationType,
  onSearchSelect,
}: FilterBarProps) {
  return (
    <AppBar position="static" sx={{ bgcolor: '#1a237e' }}>
      <Toolbar sx={{ gap: 2, flexWrap: 'wrap', py: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mr: 2, whiteSpace: 'nowrap' }}>
          Wiki 知识图谱
        </Typography>

        <SearchBox nodes={allNodes} onSelect={onSearchSelect} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" sx={{ opacity: 0.8, whiteSpace: 'nowrap' }}>
            节点类型:
          </Typography>
          <ToggleButtonGroup size="small">
            {Object.entries(NODE_TYPE_LABELS).map(([key, label]) => (
              <ToggleButton
                key={key}
                value={key}
                selected={activeNodeTypes.has(key)}
                onClick={() => toggleNodeType(key)}
                sx={{
                  color: '#fff',
                  borderColor: 'rgba(255,255,255,0.3)',
                  textTransform: 'none',
                  px: 1.5,
                  '&.Mui-selected': {
                    bgcolor: NODE_COLORS[key],
                    color: '#fff',
                    '&:hover': { bgcolor: NODE_COLORS[key], opacity: 0.9 },
                  },
                }}
              >
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
          <Typography variant="body2" sx={{ opacity: 0.8, whiteSpace: 'nowrap', mr: 0.5 }}>
            关系类型:
          </Typography>
          {Object.entries(RELATION_TYPE_LABELS).map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              size="small"
              clickable
              onClick={() => toggleRelationType(key)}
              sx={{
                bgcolor: activeRelationTypes.has(key)
                  ? RELATION_COLORS[key]
                  : 'rgba(255,255,255,0.15)',
                color: '#fff',
                fontSize: 11,
                height: 24,
                '&:hover': { opacity: 0.85 },
              }}
            />
          ))}
        </Box>

        {stats && (
          <Typography variant="body2" sx={{ ml: 'auto', opacity: 0.8, whiteSpace: 'nowrap' }}>
            {stats.nodes} 节点 / {stats.links} 关系 / {stats.claims} 论断
          </Typography>
        )}
      </Toolbar>
    </AppBar>
  );
}
