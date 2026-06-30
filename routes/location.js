import express from 'express';
import { supabase } from '../supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/ping', authenticate, async (req, res) => {
  const { lat, lng } = req.body;
  try {
    await supabase.from('location_logs').insert([{
      user_id: req.user.id, lat, lng
    }]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/latest', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('get_latest_locations');
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;