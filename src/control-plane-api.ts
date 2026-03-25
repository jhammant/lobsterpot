import express from 'express';
import { Server } from 'http';
import { ControlPlaneDaemon } from './control-plane.js';

export function registerControlPlaneRoutes(app: express.Application, daemon: ControlPlaneDaemon): void {
  app.use(express.json());

  app.get('/health', (_req, res) => {
    const pots = daemon.listPots();
    res.json({
      status: 'ok',
      pots: pots.length,
      active: pots.filter(p => ['running', 'waiting', 'compacting', 'restarting'].includes(p.state)).length,
    });
  });

  app.get('/status', (_req, res) => {
    res.json({ pots: daemon.listPots() });
  });

  app.get('/pot/:id', (req, res) => {
    const pot = daemon.getPot(req.params.id);
    if (!pot) return res.status(404).json({ error: 'Not found' });
    res.json(pot);
  });

  app.post('/pot/:id/nudge', async (req, res) => {
    try {
      const pot = await daemon.nudgePot(req.params.id, req.body?.prompt);
      res.json(pot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });

  app.post('/pot/:id/compact', async (req, res) => {
    try {
      const pot = await daemon.compactPot(req.params.id);
      res.json(pot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });

  app.post('/pot/:id/kill', (req, res) => {
    try {
      const pot = daemon.killPot(req.params.id);
      res.json(pot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });

  app.post('/pot', async (req, res) => {
    try {
      const pot = await daemon.createPot(req.body);
      res.status(201).json(pot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });
}

export function createControlPlaneApi(
  daemon: ControlPlaneDaemon,
  port = 7555,
  options: { listen?: boolean; host?: string } = {},
): {
  app: express.Application;
  server?: Server;
} {
  const app = express();
  registerControlPlaneRoutes(app, daemon);

  if (options.listen === false) {
    return { app };
  }

  const server = app.listen(port, options.host ?? '127.0.0.1', () => {
    console.log(`LobsterPot control plane listening on http://127.0.0.1:${port}`);
  });

  return { app, server };
}
