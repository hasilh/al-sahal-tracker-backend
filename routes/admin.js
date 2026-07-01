import express from 'express';
import bcrypt from 'bcryptjs';
import { supabase } from '../supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Admin creates a salesman account
router.post('/create-salesman', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'All fields required' });
  try {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();
    if (existing)
      return res.status(400).json({ error: `An account with ${email} already exists` });

    const password_hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from('users')
      .insert([{
        email: email.toLowerCase().trim(),
        password_hash,
        password_plain: password,
        name,
        role: 'salesman'
      }])
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, user: { id: data.id, name: data.name, email: data.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all salesmen
router.get('/salesmen', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, created_at')
      .eq('role', 'salesman')
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get salesman credentials (email + password) for admin
router.get('/salesmen/:id/credentials', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  try {
    const { data, error } = await supabase
      .from('users')
      .select('name, email, password_plain')
      .eq('id', req.params.id)
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get notifications
router.get('/notifications', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark notifications as read
router.patch('/notifications/read', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  try {
    await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sales target: admin sets/updates a salesman's target for a month ──
// month expected as 'YYYY-MM-01'
router.post('/sales-target', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const { user_id, month, target_amount } = req.body;
  if (!user_id || !month || target_amount == null)
    return res.status(400).json({ error: 'user_id, month and target_amount are required' });
  try {
    const { data, error } = await supabase
      .from('sales_targets')
      .upsert({
        user_id, month, target_amount,
        updated_by: req.user.id,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,month' })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sales target + achieved amount for a salesman/month ───────────
// Salesmen can call this for themselves; admin can pass user_id.
router.get('/sales-target', authenticate, async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7) + '-01';
  const user_id = req.user.role === 'admin' ? (req.query.user_id || req.user.id) : req.user.id;
  try {
    const { data: target } = await supabase
      .from('sales_targets')
      .select('*')
      .eq('user_id', user_id)
      .eq('month', month)
      .maybeSingle();

    const monthStart = new Date(month + 'T00:00:00');
    const monthEnd = new Date(monthStart); monthEnd.setMonth(monthEnd.getMonth() + 1);

    const { data: sales, error } = await supabase
      .from('sales_log')
      .select('amount')
      .eq('user_id', user_id)
      .eq('status', 'paid')
      .gte('created_at', monthStart.toISOString())
      .lt('created_at', monthEnd.toISOString());
    if (error) return res.status(400).json({ error: error.message });

    const achieved = (sales || []).reduce((sum, s) => sum + Number(s.amount || 0), 0);
    res.json({
      month,
      target_amount: target?.target_amount || 0,
      achieved_amount: achieved
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Per-salesman summary: today's & all-time visit/delivery counts ──
router.get('/salesmen/:id/summary', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const userId = req.params.id;
  try {
    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(); end.setHours(23,59,59,999);

    const [visitsToday, visitsTotal, deliveriesToday, deliveriesTotal] = await Promise.all([
      supabase.from('visits').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('visited_at', start.toISOString()).lte('visited_at', end.toISOString()),
      supabase.from('visits').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('delivery_logs').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('created_at', start.toISOString()).lte('created_at', end.toISOString()),
      supabase.from('delivery_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    ]);

    res.json({
      visits_today: visitsToday.count || 0,
      visits_total: visitsTotal.count || 0,
      deliveries_today: deliveriesToday.count || 0,
      deliveries_total: deliveriesTotal.count || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete salesman — keeps visits and delivery records (SET NULL via FK)
router.delete('/salesmen/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  try {
    await supabase.from('tracking_status').delete().eq('user_id', req.params.id);
    await supabase.from('location_logs').delete().eq('user_id', req.params.id);
    // visits and delivery_logs are kept — user_id becomes NULL via SET NULL FK
    await supabase.from('users').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;