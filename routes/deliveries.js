import express from 'express';
import { supabase } from '../supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// ── Shared filter helper ──────────────────────────────────────────
function applyDateFilter(query, filter, field = 'created_at') {
  const now = new Date();
  if (filter === 'today') {
    const start = new Date(now); start.setHours(0,0,0,0);
    const end = new Date(now); end.setHours(23,59,59,999);
    return query.gte(field, start.toISOString()).lte(field, end.toISOString());
  } else if (filter === 'yesterday') {
    const start = new Date(now); start.setDate(start.getDate()-1); start.setHours(0,0,0,0);
    const end = new Date(start); end.setHours(23,59,59,999);
    return query.gte(field, start.toISOString()).lte(field, end.toISOString());
  } else if (filter === 'week') {
    const start = new Date(now); start.setDate(start.getDate()-7); start.setHours(0,0,0,0);
    return query.gte(field, start.toISOString());
  } else if (filter === 'month') {
    const start = new Date(now); start.setDate(1); start.setHours(0,0,0,0);
    return query.gte(field, start.toISOString());
  } else if (filter === 'older') {
    const end = new Date(now); end.setDate(1); end.setHours(0,0,0,0);
    return query.lte(field, end.toISOString());
  }
  return query; // no filter → return all
}

// ── Log a delivery ────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const { invoice_number, delivered_person, payment_method, lat, lng } = req.body;
  if (!invoice_number || !delivered_person || !payment_method) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  try {
    // Use passed lat/lng, or fall back to latest location_log
    let delivLat = lat;
    let delivLng = lng;
    if (!delivLat || !delivLng) {
      const { data: locData } = await supabase
        .from('location_logs')
        .select('lat, lng')
        .eq('user_id', req.user.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .single();
      if (locData) { delivLat = locData.lat; delivLng = locData.lng; }
    }

    const { data, error } = await supabase.from('delivery_logs').insert([{
      user_id: req.user.id,
      salesman_name: req.user.name,
      invoice_number,
      delivered_person,
      payment_method,
      status: payment_method === 'not_paid' ? 'not_paid' : 'paid',
      lat: delivLat,
      lng: delivLng
    }]).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get all deliveries (admin) or own (salesman) ──────────────────
router.get('/', authenticate, async (req, res) => {
  const { filter, user_id } = req.query;
  try {
    let query = supabase
      .from('delivery_logs')
      .select('*, users!delivery_logs_user_id_fkey(name, email)')
      .order('created_at', { ascending: false });

    if (req.user.role === 'salesman') {
      query = query.eq('user_id', req.user.id);
    } else if (user_id) {
      query = query.eq('user_id', user_id);
    }

    query = applyDateFilter(query, filter, 'created_at');

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get not paid invoices ─────────────────────────────────────────
router.get('/not-paid', authenticate, async (req, res) => {
  const { filter } = req.query;
  try {
    let query = supabase
      .from('delivery_logs')
      .select('*, users!delivery_logs_user_id_fkey(name, email)')
      .in('status', ['not_paid', 'pending_approval'])
      .order('created_at', { ascending: false });

    if (req.user.role === 'salesman') {
      query = query.eq('user_id', req.user.id);
    }

    query = applyDateFilter(query, filter, 'created_at');

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get paid invoices ─────────────────────────────────────────────
router.get('/paid', authenticate, async (req, res) => {
  const { filter } = req.query;
  try {
    let query = supabase
      .from('delivery_logs')
      .select('*, users!delivery_logs_user_id_fkey(name, email)')
      .eq('status', 'paid')
      .order('approved_at', { ascending: false });

    if (req.user.role === 'salesman') {
      query = query.eq('user_id', req.user.id);
    }

    query = applyDateFilter(query, filter, 'approved_at');

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Salesman marks invoice as paid (goes to pending) ──────────────
router.patch('/request-payment/:id', authenticate, async (req, res) => {
  const { payment_method } = req.body;
  try {
    const { data, error } = await supabase
      .from('delivery_logs')
      .update({ status: 'pending_approval', payment_method })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('notifications').insert([{
      message: `${req.user.name} marked invoice ${data.invoice_number} as paid`,
      type: 'payment_pending'
    }]);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin approves payment ────────────────────────────────────────
router.patch('/approve/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  try {
    const { data, error } = await supabase
      .from('delivery_logs')
      .update({
        status: 'paid',
        approved_by: req.user.id,
        approved_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;