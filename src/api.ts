/**
 * REST API for LobsterPot — allows OpenClaw and other tools to manage pots remotely.
 * 
 * Endpoints:
 *   GET    /pots           — list all pots
 *   GET    /pots/:id       — get pot status + last output
 *   POST   /pots           — create a new pot
 *   POST   /pots/:id/send  — send message to a pot
 *   GET    /pots/:id/capture — capture current output
 *   DELETE /pots/:id       — kill a pot
 *   GET    /health         — health check
 */

import express from 'express';
import { PotManager } from './pot-manager.js';
import { LobsterPotConfig } from './types.js';

export function createAPI(manager: PotManager, port = 7450): express.Application {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    const pots = manager.list();
    res.json({
      status: 'healthy',
      pots: pots.length,
      active: pots.filter(p => p.state === 'running').length,
    });
  });

  app.get('/pots', (_req, res) => {
    res.json({ pots: manager.list() });
  });

  app.get('/pots/:id', (req, res) => {
    const pot = manager.get(req.params.id);
    if (!pot) return res.status(404).json({ error: 'Not found' });
    const output = manager.capture(req.params.id, 40);
    res.json({ ...pot, currentOutput: output });
  });

  app.post('/pots', async (req, res) => {
    try {
      const pot = await manager.create(req.body);
      res.status(201).json(pot);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/pots/:id/send', (req, res) => {
    try {
      manager.send(req.params.id, req.body.message);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/pots/:id/capture', (req, res) => {
    try {
      const lines = parseInt(req.query.lines as string) || 40;
      const output = manager.capture(req.params.id, lines);
      res.json({ output });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/pots/:id', (req, res) => {
    try {
      manager.kill(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.listen(port, '127.0.0.1', () => {
    console.log(`🦞 LobsterPot API listening on http://127.0.0.1:${port}`);
  });

  return app;
}
