import React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Typography,
  Grid,
  Box,
  Chip
} from '@mui/material';

interface BacktestResultsProps {
  results: any;
}

export default function BacktestResults({ results }: BacktestResultsProps) {
  if (!results) return null;

  const metrics = [
    { label: 'Total Return', value: `${results.totalReturn?.toFixed(2) || '0.00'}%`, color: results.totalReturn >= 0 ? 'success' : 'error' },
    { label: 'Trade Count', value: results.tradeCount?.toString() || '0', color: 'primary' },
    { label: 'Win Rate', value: `${results.winRate?.toFixed(1) || '0.0'}%`, color: 'info' },
    { label: 'Max Drawdown', value: `${results.maxDrawdown?.toFixed(2) || '0.00'}%`, color: 'warning' },
    { label: 'Sharpe Ratio', value: results.sharpeRatio?.toFixed(3) || '0.000', color: 'success' },
    { label: 'Max Leverage', value: `${results.maxLeverage?.toFixed(1) || '0.0'}x`, color: 'info' },
  ];

  return (
    <Card variant="elevation" sx={{ mt: 2 }}>
      <CardHeader
        title={
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h6" component="div">
              Backtest Results
            </Typography>
            <Chip label="Historical Performance" color="primary" size="small" />
          </Box>
        }
      />
      <CardContent>
        <Grid container spacing={2}>
          {metrics.map((metric, index) => (
            <Grid item xs={6} md={2} key={index}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 1,
                  textAlign: 'center',
                  backgroundColor: `${metric.color}.light`,
                  border: `2px solid ${metric.color}.main`,
                  cursor: 'pointer',
                  transition: 'transform 0.15s',
                  '&:hover': {
                    transform: 'scale(1.05)'
                  }
                }}
              >
                <Typography variant="h4" component="div" sx={{ color: `${metric.color}.main` }}>
                  {metric.value}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  {metric.label}
                </Typography>
              </Box>
            </Grid>
          ))}
        </Grid>

        <Box mt={3}>
          <Typography variant="body1" gutterBottom>
            Equity Curve:
          </Typography>
          <Box
            sx={{
              height: 150,
              width: '100%',
              border: '1px solid #e0e0e0',
              borderRadius: 1,
              backgroundColor: '#fafafa',
              position: 'relative'
            }}
          >
            {/* Placeholder for equity curve chart */}
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 800 150"
              style={{ overflow: 'visible' }}
            >
              <defs>
                <linearGradient id="equityGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#4caf50" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#4caf50" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0,150 L100,120 L200,100 L300,80 L400,90 L500,70 L600,50 L700,60 L800,30"
                fill="none"
                stroke="#4caf50"
                strokeWidth="2"
              />
              <ellipse
                cx="800"
                cy="30"
                rx="20"
                ry="10"
                fill="#4caf50"
                opacity="0.2"
              />
            </svg>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}