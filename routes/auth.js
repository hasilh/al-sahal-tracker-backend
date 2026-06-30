import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../supabase.js';

const router = express.Router();

router.post('/signup', async (req, res) => {
  const { email, password, name, role } = req.body;
  try {
    const password_hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from('users')
      .insert([{ email, password_hash, name, role: role || 'salesman' }])
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    const token = jwt.sign(
      { id: data.id, role: data.role, name: data.name },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, role: data.role, name: data.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/signin', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();
    if (error || !data) return res.status(400).json({ error: 'User not found' });
    const valid = await bcrypt.compare(password, data.password_hash);
    if (!valid) return res.status(400).json({ error: 'Wrong password' });
    const token = jwt.sign(
      { id: data.id, role: data.role, name: data.name },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, role: data.role, name: data.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;