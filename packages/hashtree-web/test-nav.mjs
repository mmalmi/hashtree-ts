// Simple test - add console logging inline to track flow
console.log('Test starting...');

const testUrl = 'http://localhost:5173/#/npub1436awcdq3czqf4nyf5nmj8j3m437hdyjwry7gh86a3wwre6jwk3sz3e7ah/asdf/two%20crowns%20frank%20dicksee.jpeg';

// Simple fetch test to verify server is running
const { exec } = await import('child_process');
const { promisify } = await import('util');
const execAsync = promisify(exec);

// Check server health
try {
  const result = await execAsync('curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/');
  console.log('Server status:', result.stdout);
} catch (e) {
  console.error('Server not running:', e.message);
  process.exit(1);
}

console.log('Test URL:', testUrl);
console.log('\nPlease test manually in browser. The key issue to debug:');
console.log('1. Does WebRTCStore exist when component first renders?');
console.log('2. Is restoreSession() completing before React renders?');
console.log('\nLet me analyze the code flow instead...');
