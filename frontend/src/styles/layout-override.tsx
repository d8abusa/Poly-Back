// Emergency layout override for dashboard tabs
export const layoutOverride = {
  display: 'flex',
  flexDirection: 'row' as any,
  width: '100%',
  maxWidth: '100vw',
  minWidth: '0',
  height: 'auto',
  gap: '18px',
  padding: '18px',
  boxSizing: 'border-box' as any,
};

export const layoutChild = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden' as any,
};
