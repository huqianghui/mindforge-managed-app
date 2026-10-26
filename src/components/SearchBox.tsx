import { useMemo } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import Fuse from 'fuse.js';
import type { WikiNode } from '../types';
import { NODE_COLORS, NODE_TYPE_LABELS } from '../theme';

interface SearchBoxProps {
  nodes: WikiNode[];
  onSelect: (nodeId: string) => void;
}

export default function SearchBox({ nodes, onSelect }: SearchBoxProps) {
  const fuse = useMemo(
    () =>
      new Fuse(nodes, {
        keys: ['title', 'tags', 'summary'],
        threshold: 0.4,
        includeScore: true,
      }),
    [nodes]
  );

  return (
    <Autocomplete
      size="small"
      sx={{ width: 280, bgcolor: 'rgba(255,255,255,0.15)', borderRadius: 1 }}
      options={nodes}
      getOptionLabel={(option) => option.title}
      filterOptions={(options, { inputValue }) => {
        if (!inputValue) return options.slice(0, 20);
        return fuse.search(inputValue, { limit: 15 }).map((r) => r.item);
      }}
      onChange={(_e, value) => {
        if (value) onSelect(value.id);
      }}
      renderOption={(props, option) => {
        const { key, ...rest } = props;
        return (
          <Box component="li" key={key} {...rest} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Chip
              label={NODE_TYPE_LABELS[option.type]}
              size="small"
              sx={{
                bgcolor: NODE_COLORS[option.type],
                color: '#fff',
                fontSize: 11,
                height: 20,
              }}
            />
            <span>{option.title}</span>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="搜索节点..."
          variant="outlined"
          sx={{
            '& .MuiOutlinedInput-root': {
              color: '#fff',
              '& fieldset': { borderColor: 'rgba(255,255,255,0.3)' },
              '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.5)' },
            },
            '& .MuiInputBase-input::placeholder': { color: 'rgba(255,255,255,0.7)' },
          }}
        />
      )}
    />
  );
}
