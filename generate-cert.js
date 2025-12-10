// generate-cert.js
// Run this to auto-generate SSL certificates for your current IP

const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Get local IP address
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  
  return 'localhost';
}

const LOCAL_IP = getLocalIPAddress();

console.log('🔐 SSL Certificate Generator');
console.log('============================\n');
console.log(`📍 Detected IP: ${LOCAL_IP}\n`);

try {
  // Check if certificates already exist
  if (fs.existsSync('key.pem') && fs.existsSync('cert.pem')) {
    console.log('⚠️  Certificates already exist!');
    console.log('   Delete them first if you want to regenerate.\n');
    
    // Check if existing cert matches current IP
    try {
      const certContent = fs.readFileSync('cert.pem', 'utf8');
      if (certContent.includes(LOCAL_IP)) {
        console.log(`✅ Existing certificate matches current IP (${LOCAL_IP})`);
        console.log('   No need to regenerate!\n');
        process.exit(0);
      } else {
        console.log('⚠️  IP address has changed!');
        console.log('   Deleting old certificates...\n');
        fs.unlinkSync('key.pem');
        fs.unlinkSync('cert.pem');
      }
    } catch (err) {
      // Can't read cert, delete and regenerate
      fs.unlinkSync('key.pem');
      fs.unlinkSync('cert.pem');
    }
  }

  console.log('🔑 Generating private key...');
  execSync('openssl genrsa -out key.pem 2048', { stdio: 'inherit' });
  
  console.log('📜 Generating certificate...');
  const certCmd = `openssl req -new -x509 -key key.pem -out cert.pem -days 365 -subj "/C=IN/ST=Karnataka/L=Bengaluru/O=Dev/CN=${LOCAL_IP}"`;
  execSync(certCmd, { stdio: 'inherit' });
  
  console.log('\n✅ Certificates generated successfully!');
  console.log('   - key.pem');
  console.log('   - cert.pem\n');
  
  // Copy to frontend if it exists
  const frontendPath = path.join(__dirname, '..', 'video-conference-frontend');
  if (fs.existsSync(frontendPath)) {
    console.log('📋 Copying to frontend...');
    fs.copyFileSync('key.pem', path.join(frontendPath, 'key.pem'));
    fs.copyFileSync('cert.pem', path.join(frontendPath, 'cert.pem'));
    console.log('✅ Copied to frontend!\n');
  }
  
  console.log('🎉 Setup complete!');
  console.log(`\n🔗 Access your app at: https://${LOCAL_IP}:5173`);
  console.log('⚠️  Remember to accept the certificate warning in your browser!\n');
  
} catch (error) {
  console.error('❌ Error generating certificates:', error.message);
  console.log('\n📝 Manual steps:');
  console.log('1. Install OpenSSL (or use Git Bash)');
  console.log('2. Run: openssl genrsa -out key.pem 2048');
  console.log(`3. Run: openssl req -new -x509 -key key.pem -out cert.pem -days 365 -subj "/CN=${LOCAL_IP}"`);
  console.log('4. Copy key.pem and cert.pem to frontend folder\n');
  process.exit(1);
}