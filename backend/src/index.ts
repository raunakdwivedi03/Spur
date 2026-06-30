import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import router from './routes';
import { dbManager } from './db';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for frontend cross-origin requests
app.use(cors());

// Parse incoming request JSON payloads
app.use(express.json());

// Mount routes
app.use(router);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start database and server
async function startServer() {
  try {
    // 1. Initialize SQLite Database
    await dbManager.init();

    // 2. Start Listening
    const server = app.listen(PORT, () => {
      console.log(`===============================================`);
      console.log(`Spur AI Support Chat Backend is running on port ${PORT}`);
      console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
      console.log(`LLM Provider Configured: ${process.env.LLM_PROVIDER || 'mock'}`);
      console.log(`===============================================`);
    });

    // Graceful Shutdown
    const shutdown = () => {
      console.log('\nReceived shutdown signal. Closing server...');
      server.close(() => {
        console.log('Express server closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
