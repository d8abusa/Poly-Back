import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Box,
  Typography,
  Grid,
  Alert,
  AlertTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  Warning,
  StopCircle,
  CheckCircle,
  Shield
} from '@mui/icons-material';
import BacktestResults from './BacktestResults';
import { Position, Portfolio, RiskLevel } from '../../types';

// Types
interface DashboardProps {
  positions: Position[];
  portfolio: Portfolio;
  backtestResults?: any;
}

interface RiskAlert {
  level: 'URGENT' | 'ALERT' | 'WARNING';
  message: string;
  timestamp: string;
}

// Risk constants
const RISK_LIMITS = {
  drawdown: { watch: 10, alert: 15, halt: 20 },
  exposure: { watch: 40, alert: 50, halt: 60 },
  position: { watch: 5, alert: 7, halt: 10 },
  dailyLoss: { watch: 2, alert: 3.5, halt: 5 },
  concentration: { watch: 6, alert: 8, halt: 10 }
};

export default function MainDashboard({ positions, portfolio, backtestResults }: DashboardProps) {
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('WATCH');
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [circuitBreaker, setCircuitBreaker] = useState(false);

  // Calculate risk metrics
  const calculateRiskMetrics = () => {
    const metrics = {
      drawdown: portfolio.drawdown || 0,
      exposure: portfolio.exposure || 0,
      totalReturn: portfolio.totalReturn || 0,
      dailyPnL: portfolio.dailyPnL || 0,
      positionSize: portfolio.positionSize || 0
    };

    // Determine risk level
    if (metrics.drawdown >= RISK_LIMITS.drawdown.halt ||
        metrics.exposure >= RISK_LIMITS.exposure.halt ||
        metrics.dailyPnL <= -RISK_LIMITS.dailyLoss.halt) {
      return { level: 'HALT' as RiskLevel, alerts: getUrgentAlerts(metrics) };
    }
    if (metrics.drawdown >= RISK_LIMITS.drawdown.alert ||
        metrics.exposure >= RISK_LIMITS.exposure.alert ||
        metrics.dailyPnL <= -RISK_LIMITS.dailyLoss.alert) {
      return { level: 'ALERT', alerts: getAlertAlerts(metrics) };
    }
    if (metrics.drawdown >= RISK_LIMITS.drawdown.watch ||
        metrics.exposure >= RISK_LIMITS.exposure.watch ||
        metrics.dailyPnL <= -RISK_LIMITS.dailyLoss.watch) {
      return { level: 'WARNING', alerts: getWarningAlerts(metrics) };
    }
    return { level: 'WATCH', alerts: [] };
  };

  const getUrgentAlerts = (metrics: any): RiskAlert[] => [
    { level: 'URGENT', message: `Portfolio Drawdown: ${metrics.drawdown.toFixed(2)}% exceeds HALT limit`, timestamp: new Date().toISOString() },
    { level: 'URGENT', message: `Exposure: ${metrics.exposure.toFixed(2)}% exceeds HALT limit`, timestamp: new Date().toISOString() }
  ];

  const getAlertAlerts = (metrics: any): RiskAlert[] => [
    { level: 'ALERT', message: `Drawdown at ${metrics.drawdown.toFixed(2)}% - near HALT limit`, timestamp: new Date().toISOString() }
  ];

  const getWarningAlerts = (metrics: any): RiskAlert[] => [
    { level: 'WARNING', message: `Position size trending toward ALERT threshold`, timestamp: new Date().toISOString() }
  ];

  useEffect(() => {
    const { level, alerts } = calculateRiskMetrics();
    setRiskLevel(level);
    setAlerts(alerts);

    // Check for circuit breaker
    if (level === 'HALT') {
      setCircuitBreaker(true);
    }
  }, [positions, portfolio]);

  const getRiskColor = (level: RiskLevel): 'primary' | 'warning' | 'error' | 'inherit' => {
    switch (level) {
      case 'ALERT': return 'warning';
      case 'URGENT': return 'error';
      case 'WARNING': return 'inherit';
      default: return 'primary';
    }
  };

  const getRiskBadge = (level: RiskLevel) => {
    const colors = {
      WATCH: { color: 'primary', icon: <CheckCircle />, text: 'WATCH' },
      WARNING: { color: 'warning', icon: <Warning />, text: 'WARNING' },
      ALERT: { color: 'warning', icon: <StopCircle />, text: 'ALERT' },
      URGENT: { color: 'error', icon: <StopCircle />, text: 'URGENT' },
      HALT: { color: 'error', icon: <Alert />, text: 'HALT' }
    };
    const badge = colors[level];
    return (
      <Box
        display="flex"
        alignItems="center"
        spacing={1}
        sx={{
          px: 2,
          py: 1,
          borderRadius: 1,
          backgroundColor: badge.color === 'primary' ? 'primary.light' : badge.color + '.light',
          color: 'white',
          fontWeight: 'bold',
          mt: 1
        }}
      >
        {badge.icon}
        <span>{badge.text}</span>
      </Box>
    );
  };

  return (
    <Box>
      {/* Circuit Breaker State */}
      {circuitBreaker && (
        <Alert severity="error" sx={{ mb: 2, fontSize: '1.1rem' }}>
          ⚠️ CIRCUIT BREAKER ACTIVATED ⚠️
          <br />
          Risk limits exceeded. HARBOR HALT in effect.
        </Alert>
      )}

      {/* Alert Banners */}
      {alerts.map((alert, index) => (
        <Alert
          key={index}
          severity={alert.level === 'URGENT' ? 'error' : alert.level === 'ALERT' ? 'warning' : 'info'}
          sx={{ mb: 2 }}
        >
          <AlertTitle>{alert.level} — {alert.message}</AlertTitle>
          Triggered at {new Date(alert.timestamp).toLocaleString()}
        </Alert>
      ))}

      {/* Risk Level Overview */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12}>
          <Card variant="elevation">
            <CardHeader
              title="Portfolio Overview"
              subheader={`Total Value: ${portfolio.value?.toFixed(2) || '0'} POLY | Return: ${portfolio.totalReturn?.toFixed(2) || '0'}%`}
              action={<Box>{getRiskBadge(riskLevel)}</Box>}
            />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={6} md={3}>
                  <Box align="center">
                    <Typography variant="h4" color="textSecondary">
                      {portfolio.value?.toFixed(2) || '0'}
                    </Typography>
                    <Typography variant="body2">Portfolio Value</Typography>
                  </Box>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Box align="center">
                    <Typography variant="h4" color="textSecondary">
                      {portfolio.drawdown?.toFixed(2) || '0'}%
                    </Typography>
                    <Typography variant="body2">Drawdown</Typography>
                  </Box>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Box align="center">
                    <Typography variant="h4" color={parseFloat(portfolio.totalReturn?.toFixed(2) || '0') >= 0 ? 'success.main' : 'error.main'}>
                      {portfolio.totalReturn?.toFixed(2) || '0'}%
                    </Typography>
                    <Typography variant="body2">Total Return</Typography>
                  </Box>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Box align="center">
                    <Typography variant="h4" color="textSecondary">
                      {portfolio.exposure?.toFixed(2) || '0'}%
                    </Typography>
                    <Typography variant="body2">Exposure</Typography>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Drawdown Monitor */}
        <Grid item xs={12} md={4}>
          <Card variant="elevation">
            <CardHeader title={<Box display="flex" alignItems="center"><DrawdownIcon /> Drawdown Monitor</Box>} />
            <CardContent>
              <Box mb={2}>
                <Typography variant="body2">Current Drawdown</Typography>
                <Typography variant="h4" color="textSecondary">
                  {portfolio.drawdown?.toFixed(2) || '0'}%
                </Typography>
              </Box>

              {/* Drawdown Ceiling Indicator */}
              <Box mb={2}>
                <Typography variant="body2">Drawdown Ceiling</Typography>
                <Box sx={{ height: 16, borderRadius: 1, overflow: 'hidden' }}>
                  <Box
                    sx={{
                      width: `${Math.min(100, portfolio.drawdown || 0) * 5}%`,
                      height: '100%',
                      backgroundColor:
                        portfolio.drawdown >= RISK_LIMITS.drawdown.halt ? 'error.main' :
                        portfolio.drawdown >= RISK_LIMITS.drawdown.alert ? 'warning.main' : 'success.main'
                    }}
                  />
                </Box>
                <Typography variant="caption" color="textSecondary">
                  HALT at {RISK_LIMITS.drawdown.halt}%
                </Typography>
              </Box>

              <Box>
                <Typography variant="body2">Distance to HALT</Typography>
                <Typography variant="body1">
                  {RISK_LIMITS.drawdown.halt - (portfolio.drawdown || 0)}% remaining
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Exposure Display */}
        <Grid item xs={12} md={8}>
          <Card variant="elevation">
            <CardHeader
              title={
                <Box display="flex" alignItems="center">
                  <TrendingUp color="info" sx={{ mr: 1 }} />
                  Exposure Control
                </Box>
              }
            />
            <CardContent>
              <Box mb={2}>
                <Typography variant="body2">Total Exposure</Typography>
                <Typography variant="h4" color="textSecondary">
                  {portfolio.exposure?.toFixed(2) || '0'}% of Portfolio
                </Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="body2">Absolute Exposure</Typography>
                <Typography variant="h4" color="textSecondary">
                  {(portfolio.value * (portfolio.exposure || 0) / 100).toFixed(2)} POLY
                </Typography>
              </Box>

              {/* Exposure Limits Reference */}
              <Grid container spacing={1}>
                <Grid item xs={3}>
                  <Box sx={{
                    p: 1,
                    borderRadius: 1,
                    textAlign: 'center',
                    borderColor: 'divider',
                    backgroundColor: (portfolio.exposure || 0) < RISK_LIMITS.exposure.watch ? 'success.light' : 'warning.light'
                  }}>
                    <Typography variant="caption">WATCH</Typography>
                    <Typography variant="body2">{RISK_LIMITS.exposure.watch}%</Typography>
                  </Box>
                </Grid>
                <Grid item xs={3}>
                  <Box sx={{
                    p: 1,
                    borderRadius: 1,
                    textAlign: 'center',
                    borderColor: 'divider',
                    backgroundColor: (portfolio.exposure || 0) >= RISK_LIMITS.exposure.watch && (portfolio.exposure || 0) < RISK_LIMITS.exposure.alert ? 'warning.light' : 'error.light'
                  }}>
                    <Typography variant="caption">ALERT</Typography>
                    <Typography variant="body2">{RISK_LIMITS.exposure.alert}%</Typography>
                  </Box>
                </Grid>
                <Grid item xs={3}>
                  <Box sx={{
                    p: 1,
                    borderRadius: 1,
                    textAlign: 'center',
                    borderColor: 'divider',
                    backgroundColor: (portfolio.exposure || 0) >= RISK_LIMITS.exposure.halt ? 'error.main' : 'divider'
                  }}>
                    <Typography variant="caption">HALT</Typography>
                    <Typography variant="body2">{RISK_LIMITS.exposure.halt}%</Typography>
                  </Box>
                </Grid>
                <Grid item xs={3}>
                  <Typography variant="body2" align="center" sx={{ mt: 1 }}>
                    Current: <strong>{(portfolio.exposure || 0).toFixed(2)}%</strong>
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Positions Table */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12}>
          <Card variant="elevation">
            <CardHeader
              title={
                <Box display="flex" alignItems="center">
                  <Box sx={{ mr: 1 }}><Shield color="primary" /></Box>
                  Open Positions
                </Box>
              }
            />
            <CardContent>
              <TableContainer component={Paper}>
                <Table>
                  <TableBody>
                    {positions.map((position, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Typography variant="body2" fontWeight="bold">
                            {position.market}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {position.type === 'LONG' ? '📈 Long' : '📉 Short'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            ${position.entryPrice?.toFixed(2) || '0.00'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            ${(portfolio.value * position.weight || 0).toFixed(2)} POLY
                            <Typography variant="caption" display="block">
                              ({position.weight?.toFixed(2) || '0'}%)
                            </Typography>
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            ${position.stopLoss?.toFixed(2) || '0.00'}
                            <Typography variant="caption" display="block" color="error.main">
                              SL: {position.slDistance?.toFixed(2) || '0'}%
                            </Typography>
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            ${position.takeProfit?.toFixed(2) || '0.00'}
                            <Typography variant="caption" display="block" color="success.main">
                              TP: {position.tpDistance?.toFixed(2) || '0'}%
                            </Typography>
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color={position.pnl >= 0 ? 'success.main' : 'error.main'}>
                            {position.pnl?.toFixed(2) || '0.00'}% (${(portfolio.value * position.pnl / 100).toFixed(2)} POLY)
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {positions.length === 0 && (
                <Box align="center" py={3}>
                  <Typography variant="body1" color="textSecondary">
                    No open positions
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Backtest Results */}
      {backtestResults && (
        <Grid item xs={12}>
          <Box>
            <BacktestResults results={backtestResults} />
          </Box>
        </Grid>
      )}

      {/* Risk Limit Reference */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12}>
          <Card variant="outlined">
            <CardHeader title="Risk Limit Reference" />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={4}>
                  <Typography variant="caption" fontWeight="bold">Drawdown Limits</Typography>
                  <Typography variant="body2">
                    WATCH: {RISK_LIMITS.drawdown.watch}% | ALERT: {RISK_LIMITS.drawdown.alert}% | HALT: {RISK_LIMITS.drawdown.halt}%
                  </Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" fontWeight="bold">Exposure Limits</Typography>
                  <Typography variant="body2">
                    WATCH: {RISK_LIMITS.exposure.watch}% | ALERT: {RISK_LIMITS.exposure.alert}% | HALT: {RISK_LIMITS.exposure.halt}%
                  </Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" fontWeight="bold">Daily Loss Limit</Typography>
                  <Typography variant="body2">
                    WATCH: {RISK_LIMITS.dailyLoss.watch}% | ALERT: {RISK_LIMITS.dailyLoss.alert}% | HALT: {RISK_LIMITS.dailyLoss.halt}%
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

// Helper components
function DrawdownIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 12l4 4 8-8" />
      <path d="M12 16l4 4" />
    </svg>
  );
}