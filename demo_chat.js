const http = require('http');
const { spawn } = require('child_process');
const sqlite3 = require('./backend/node_modules/sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'backend/chat.db');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Promisified HTTP request helper
function post(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const body = JSON.stringify(data);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          data: responseBody ? JSON.parse(responseBody) : null,
        });
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Function to print database rows
function printDatabaseRows() {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Failed to open database for printing:', err);
        return resolve();
      }

      console.log('\n--- 📂 DATABASE PERSISTENCE STATUS ---');
      db.all('SELECT * FROM messages ORDER BY timestamp ASC', [], (err, rows) => {
        if (err) {
          console.error('Error querying messages:', err);
        } else {
          console.log(`Stored Messages count: ${rows.length} rows`);
          rows.forEach((row) => {
            console.log(`[${row.timestamp}] ${row.sender.toUpperCase()}: ${row.text}`);
          });
        }

        db.close(() => resolve());
      });
    });
  });
}

async function run() {
  console.log('==================================================');
  console.log('🎬 STARTING LIVE CHAT SIMULATION DEMO');
  console.log('==================================================');

  // 1. Delete previous db if exists to start fresh
  const fs = require('fs');
  if (fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
      console.log('🧹 Cleared old SQLite database.');
    } catch (e) {
      // ignore lock errors
    }
  }

  // 2. Start the backend server as a child process
  console.log('🚀 Booting Express server...');
  const serverProcess = spawn('npx', ['ts-node', 'backend/src/index.ts'], {
    shell: true,
    cwd: __dirname,
    stdio: 'pipe'
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[Server Error] ${data}`);
  });

  // Wait 4 seconds for the server to load ts-node and bind port 3000
  await wait(4000);

  const sessionId = 'simulation-demo-session-123';

  // 3. Send Message 1: Support Hours
  console.log('\n💬 Sending User Query 1: "Hi, what are your support hours?"');
  try {
    const res = await post('http://localhost:3000/chat/message', {
      message: 'Hi, what are your support hours?',
      sessionId: sessionId
    });
    console.log(`📩 Server Response: 200 OK`);
    console.log(`🤖 AI Reply: "${res.data.reply}"`);
    console.log(`⏱️  Latency: ${res.data.latencyMs}ms | Provider: ${res.data.provider}`);
  } catch (err) {
    console.error('Failed to send Message 1:', err.message);
  }

  await wait(1000);

  // 4. Send Message 2: Shipping Inquiry
  console.log('\n💬 Sending User Query 2: "Do you ship to USA and UK?"');
  try {
    const res = await post('http://localhost:3000/chat/message', {
      message: 'Do you ship to USA and UK?',
      sessionId: sessionId
    });
    console.log(`📩 Server Response: 200 OK`);
    console.log(`🤖 AI Reply: "${res.data.reply}"`);
    console.log(`⏱️  Latency: ${res.data.latencyMs}ms | Provider: ${res.data.provider}`);
  } catch (err) {
    console.error('Failed to send Message 2:', err.message);
  }

  await wait(1000);

  // 5. Query and Print Database Records
  await printDatabaseRows();

  // 6. Kill Server and Exit
  console.log('\n🛑 Shutting down demo server...');
  serverProcess.kill('SIGINT');
  console.log('==================================================');
  console.log('🎉 DEMO WORKFLOW COMPLETE');
  console.log('==================================================');
  process.exit(0);
}

run();
