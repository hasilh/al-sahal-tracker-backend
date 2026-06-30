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

export default router;