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

export default router;