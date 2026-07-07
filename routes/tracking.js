import express from 'express';
import { supabase } from '../supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Salesman updates tracking status
router.post('/status', authenticate, async (req, res) => {
  const { is_tracking, vehicle, start_km, end_km } = req.body;
  try {
    const updatePayload = {
      user_id: req.user.id,
      is_tracking,
      updated_at: new Date().toISOString()
    };

    let total_km = null;
    if (is_tracking) {
      // Starting work — store vehicle and starting km
      updatePayload.vehicle = vehicle || null;
      updatePayload.start_km = start_km !== undefined ? Number(start_km) : null;
      updatePayload.end_km = null;
      updatePayload.total_km = null;
    } else {
      // Ending work — store ending km and compute total
      updatePayload.end_km = end_km !== undefined ? Number(end_km) : null;
      if (start_km !== undefined && end_km !== undefined) {
        total_km = Number(end_km) - Number(start_km);
        updatePayload.total_km = total_km;
      }
    }

    const { error } = await supabase
      .from('tracking_status')
      .upsert(updatePayload, { onConflict: 'user_id' });

    if (error) return res.status(400).json({ error: error.message });

    // Build notification message
    let message;
    if (is_tracking) {
      message = `${req.user.name} has started work\nVehicle: ${vehicle || '-'}\nStarting KM: ${start_km ?? '-'}`;
    } else {
      message = `${req.user.name} has stopped work\nVehicle: ${vehicle || '-'}\nStarting KM: ${start_km ?? '-'}\nEnding KM: ${end_km ?? '-'}\nTotal Distance: ${total_km !== null ? total_km : '-'} KM`;
    }

    await supabase.from('notifications').insert([{
      message,
      type: is_tracking ? 'tracking_on' : 'tracking_off'
    }]);

    res.json({ success: true, total_km });
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

export default router;