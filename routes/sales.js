import express from 'express';
import { supabase } from '../supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

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
  return query;
}

// ── Log a sale ─────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const { invoice_number, delivered_to, amount, payment_method } = req.body;
  if (!invoice_number || !delivered_to || !payment_method) {
    return res.status(400).json({ error: 'Invoice number, delivered to and payment method are required' });
  }
  try {
    const { data, error } = await supabase.from('sales_log').insert([{
      user_id: req.user.id,
      salesman_name: req.user.name,
      invoice_number,
      delivered_to,
      amount: amount || 0,
      payment_method,
      status: payment_method === 'not_paid' ? 'not_paid' : 'paid',
      source: 'sales'
    }]).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get sales log (own for salesman, all/by user for admin) ────────
router.get('/', authenticate, async (req, res) => {
  const { filter, user_id } = req.query;
  try {
    let query = supabase
      .from('sales_log')
      .select('*, users(name, email)')
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

// ── Not-paid sales entries ──────────────────────────────────────────
router.get('/not-paid', authenticate, async (req, res) => {
  try {
    let query = supabase
      .from('sales_log')
      .select('*, users(name, email)')
      .in('status', ['not_paid', 'pending_approval'])
      .order('created_at', { ascending: false });

    if (req.user.role === 'salesman') {
      query = query.eq('user_id', req.user.id);
    }

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Salesman marks a not-paid sale as paid (goes to pending) ───────
router.patch('/request-payment/:id', authenticate, async (req, res) => {
  const { payment_method } = req.body;
  try {
    const { data, error } = await supabase
      .from('sales_log')
      .update({ status: 'pending_approval', payment_method })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('notifications').insert([{
      message: `${req.user.name} marked sale invoice ${data.invoice_number} as paid`,
      type: 'payment_pending'
    }]);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin approves a sale payment ───────────────────────────────────
router.patch('/approve/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  try {
    const { data, error } = await supabase
      .from('sales_log')
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

// insert after the existing `router.patch('/approve/:id', ...)` block, before `export default router;`

// ── Admin directly marks a sale as paid (bypasses salesman) ───────
router.patch('/admin-mark-paid/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const { payment_method } = req.body;
  if (!payment_method) return res.status(400).json({ error: 'Payment method required' });
  try {
    const { data, error } = await supabase
      .from('sales_log')
      .update({
        status: 'paid',
        payment_method,
        approved_by: req.user.id,
        approved_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('notifications').insert([{
      message: `Admin marked sale invoice ${data.invoice_number} as paid directly`,
      type: 'payment_pending'
    }]);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
