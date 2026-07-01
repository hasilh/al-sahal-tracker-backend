import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import locationRoutes from './routes/location.js';
import visitRoutes from './routes/visits.js';
import deliveryRoutes from './routes/deliveries.js';
import trackingRoutes from './routes/tracking.js';
import adminRoutes from './routes/admin.js';
import salesRoutes from './routes/sales.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/sales', salesRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});