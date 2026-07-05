import express from 'express';
import { supabase } from '../supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

function applyDateFilter(query, filter, field = 'visited_at') {
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

// ── Create visit ──────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const { company_name, contact_name, mobile, email_id, quotation, quotation_description, lat, lng } = req.body;
  if (!company_name || !contact_name || !mobile)
    return res.status(400).json({ error: 'Company name, contact name and mobile are required' });
  if (quotation && !quotation_description)
    return res.status(400).json({ error: 'Quotation description is required when quotation is selected' });
  try {
    let visitLat = lat;
    let visitLng = lng;
    if (!visitLat || !visitLng) {
      const { data: locData } = await supabase
        .from('location_logs')
        .select('lat, lng')
        .eq('user_id', req.user.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .single();
      if (locData) { visitLat = locData.lat; visitLng = locData.lng; }
    }
    const { data, error } = await supabase.from('visits').insert([{
      user_id: req.user.id,
      salesman_name: req.user.name,
      company_name, contact_name, mobile, email_id,
      quotation, quotation_description,
      lat: visitLat, lng: visitLng
    }]).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get visits ────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { filter, user_id } = req.query;
  try {
    let query = supabase
      .from('visits')
      .select('*, users(name, email)')
      .order('visited_at', { ascending: false });

    if (req.user.role === 'salesman') {
      query = query.eq('user_id', req.user.id);
    } else if (user_id) {
      query = query.eq('user_id', user_id);
    }

    query = applyDateFilter(query, filter, 'visited_at');

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Salesman requests edit (stored as pending, notifies admin) ────
router.patch('/:id/request-edit', authenticate, async (req, res) => {
  const { company_name, contact_name, mobile, email_id, quotation, quotation_description } = req.body;
  try {
    const { data: original } = await supabase
      .from('visits').select('*').eq('id', req.params.id).single();
    if (!original) return res.status(404).json({ error: 'Visit not found' });
    if (req.user.role === 'salesman' && original.user_id !== req.user.id)
      return res.status(403).json({ error: 'Not your record' });

    const proposed = {};
    if (company_name !== undefined) proposed.company_name = company_name;
    if (contact_name !== undefined) proposed.contact_name = contact_name;
    if (mobile !== undefined) proposed.mobile = mobile;
    if (email_id !== undefined) proposed.email_id = email_id;
    if (quotation !== undefined) proposed.quotation = quotation;
    if (quotation_description !== undefined) proposed.quotation_description = quotation_description;

    const pendingEdit = JSON.stringify({
      original: {
        company_name: original.company_name,
        contact_name: original.contact_name,
        mobile: original.mobile,
        email_id: original.email_id,
        quotation: original.quotation,
        quotation_description: original.quotation_description
      },
      proposed,
      requested_by: req.user.name,
      requested_at: new Date().toISOString()
    });

    const { data, error } = await supabase
      .from('visits')
      .update({ pending_edit: pendingEdit, edit_status: 'pending' })
      .eq('id', req.params.id)
      .select().single();
    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('notifications').insert([{
      message: `${req.user.name} requested an edit on visit to ${original.company_name}`,
      type: 'edit_request'
    }]);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin approves or rejects a visit edit ────────────────────────
router.patch('/:id/approve-edit', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const { approve } = req.body;
  try {
    const { data: visit } = await supabase
      .from('visits').select('*').eq('id', req.params.id).single();
    if (!visit) return res.status(404).json({ error: 'Visit not found' });

    let update = {};
    if (approve) {
      const pending = JSON.parse(visit.pending_edit || '{}');
      update = { ...pending.proposed, edit_status: 'approved', pending_edit: null };
    } else {
      update = { edit_status: 'rejected', pending_edit: null };
    }

    const { data, error } = await supabase
      .from('visits').update(update).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;