import express from 'express';
import { supabase } from '../supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Salesman updates tracking status
router.post('/status', authenticate, async (req, res) => {
  const { is_tracking } = req.body;
  try {
    // Upsert tracking status
    const { error } = await supabase
      .from('tracking_status')
      .upsert({
        user_id: req.user.id,
        is_tracking,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (error) return res.status(400).json({ error: error.message });

    // Manage work_sessions: open one when starting, close the open one when stopping
    if (is_tracking) {
      const { data: openSession } = await supabase
        .from('work_sessions')
        .select('id')
        .eq('user_id', req.user.id)
        .is('ended_at', null)
        .maybeSingle();
      if (!openSession) {
        await supabase.from('work_sessions').insert([{
          user_id: req.user.id,
          started_at: new Date().toISOString(),
          work_date: new Date().toISOString().slice(0, 10)
        }]);
      }
    } else {
      await supabase
        .from('work_sessions')
        .update({ ended_at: new Date().toISOString() })
        .eq('user_id', req.user.id)
        .is('ended_at', null);
    }

    // Notify admin
    await supabase.from('notifications').insert([{
      message: `${req.user.name} has ${is_tracking ? 'started' : 'stopped'} work`,
      type: is_tracking ? 'tracking_on' : 'tracking_off'
    }]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all salesmen tracking status (admin)
router.get('/all', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  try {
    const { data, error } = await supabase
      .from('tracking_status')
      .select('*, users(name, email)')
      .order('updated_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Work session history (admin) ────────────────────────────────
// Returns each work session for a salesman, grouped by date, newest first.
// filter: today | yesterday | week | month | older | all
router.get('/sessions', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const { user_id, filter } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  try {
    let query = supabase
      .from('work_sessions')
      .select('*')
      .eq('user_id', user_id)
      .order('started_at', { ascending: false });

    const now = new Date();
    const toDateStr = (d) => d.toISOString().slice(0, 10);
    if (filter === 'today') {
      query = query.eq('work_date', toDateStr(now));
    } else if (filter === 'yesterday') {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      query = query.eq('work_date', toDateStr(y));
    } else if (filter === 'week') {
      const start = new Date(now); start.setDate(start.getDate() - 7);
      query = query.gte('work_date', toDateStr(start));
    } else if (filter === 'older') {
      const start = new Date(now); start.setDate(start.getDate() - 7);
      query = query.lt('work_date', toDateStr(start));
    }
    // 'all' or no filter → everything

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Route (line of points) for a single work session ─────────────
router.get('/route/:sessionId', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  try {
    const { data: session, error: sErr } = await supabase
      .from('work_sessions')
      .select('*')
      .eq('id', req.params.sessionId)
      .single();
    if (sErr || !session) return res.status(404).json({ error: 'Session not found' });

    const end = session.ended_at || new Date().toISOString();
    const { data: points, error } = await supabase
      .from('location_logs')
      .select('lat, lng, recorded_at')
      .eq('user_id', session.user_id)
      .gte('recorded_at', session.started_at)
      .lte('recorded_at', end)
      .order('recorded_at', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });

    res.json({ session, points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;