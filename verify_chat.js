const http = require('http');

const API_BASE = 'http://localhost:3000';

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
          headers: res.headers,
          data: responseBody ? JSON.parse(responseBody) : null,
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: responseBody ? JSON.parse(responseBody) : null,
        });
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function runTests() {
  console.log('==========================================');
  console.log('🚀 RUNNING INTEGRATION & ROBUSTNESS TESTS');
  console.log('==========================================');

  let sessionId;

  // Test 1: Health Check
  try {
    const res = await get(`${API_BASE}/health`);
    console.log('✅ Test 1 Passed: Health Check status code:', res.statusCode);
  } catch (err) {
    console.error('❌ Test 1 Failed: Cannot connect to server. Is the backend running? Run npm run dev first.');
    process.exit(1);
  }

  // Test 2: Send a valid query (standard case)
  try {
    const res = await post(`${API_BASE}/chat/message`, {
      message: 'Do you ship to USA?',
    });
    
    if (res.statusCode === 200 && res.data.reply && res.data.sessionId) {
      sessionId = res.data.sessionId;
      console.log('✅ Test 2 Passed: Standard chat response received.');
      console.log('   Session ID:', sessionId);
      console.log('   AI Reply:', res.data.reply);
      console.log('   LLM Provider:', res.data.provider);
      console.log('   Latency:', res.data.latencyMs, 'ms');
    } else {
      console.error('❌ Test 2 Failed: Unexpected response format', res);
    }
  } catch (err) {
    console.error('❌ Test 2 Failed:', err);
  }

  // Test 3: Session Persistence
  try {
    const res = await get(`${API_BASE}/sessions/${sessionId}`);
    
    if (res.statusCode === 200 && Array.isArray(res.data) && res.data.length >= 2) {
      console.log('✅ Test 3 Passed: Persistent session history retrieved.');
      console.log('   Stored Messages:', res.data.length);
      console.log('   Persisted text:', res.data[0].text);
    } else {
      console.error('❌ Test 3 Failed: Messages were not properly persisted.', res.data);
    }
  } catch (err) {
    console.error('❌ Test 3 Failed:', err);
  }

  // Test 4: Truncate very long messages
  try {
    const longMsg = 'A'.repeat(1200); // Exceeds 1000 character limit
    const res = await post(`${API_BASE}/chat/message`, {
      message: longMsg,
      sessionId: sessionId
    });

    if (res.statusCode === 200 && res.data.warning) {
      console.log('✅ Test 4 Passed: Extremely long message was gracefully handled.');
      console.log('   Warning:', res.data.warning);
    } else {
      console.error('❌ Test 4 Failed: Long message did not return warning.', res.data);
    }
  } catch (err) {
    console.error('❌ Test 4 Failed:', err);
  }

  // Test 5: Reject empty messages
  try {
    const res = await post(`${API_BASE}/chat/message`, {
      message: '  ',
      sessionId: sessionId
    });

    if (res.statusCode === 400) {
      console.log('✅ Test 5 Passed: Empty message was rejected (400 Bad Request).');
      console.log('   Response:', res.data);
    } else {
      console.error('❌ Test 5 Failed: Empty message did not trigger 400 validation error.', res);
    }
  } catch (err) {
    console.error('❌ Test 5 Failed:', err);
  }

  // Test 6: Verify LLM Debug logs list
  try {
    const res = await get(`${API_BASE}/logs`);
    if (res.statusCode === 200 && Array.isArray(res.data) && res.data.length > 0) {
      console.log('✅ Test 6 Passed: LLM Logs are recorded successfully.');
      console.log('   Total recorded logs:', res.data.length);
    } else {
      console.error('❌ Test 6 Failed: LLM Logs list empty or failed.', res.data);
    }
  } catch (err) {
    console.error('❌ Test 6 Failed:', err);
  }

  console.log('==========================================');
  console.log('🎉 INTEGRATION AND STRESS TESTS COMPLETE');
  console.log('==========================================');
}

runTests();
