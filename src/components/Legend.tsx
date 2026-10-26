import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { NODE_COLORS, NODE_TYPE_LABELS } from '../theme';

export default function Legend() {
  return (
    <Paper
      elevation={3}
      sx={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        p: 1.5,
        zIndex: 10,
        minWidth: 120,
        bgcolor: 'rgba(255,255,255,0.95)',
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 700, mb: 0.5, display: 'block' }}>
        节点类型
      </Typography>
      {Object.entries(NODE_TYPE_LABELS).map(([key, label]) => (
        <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.3 }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              bgcolor: NODE_COLORS[key],
              flexShrink: 0,
            }}
          />
          <Typography variant="caption">{label}</Typography>
        </Box>
      ))}
      <Typography variant="caption" sx={{ fontWeight: 700, mt: 1, mb: 0.5, display: 'block' }}>
        节点大小 = 论断数量
      </Typography>
    </Paper>
  );
}
