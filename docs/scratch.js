const https = require('https');

const data = new URLSearchParams();
data.append('geom', JSON.stringify({ type: 'LineString', coordinates: [[6.9535, 46.2575], [6.9635, 46.2675]] }));
data.append('sr', '4326');
data.append('offset', '25');

const req = https.request('https://api3.geo.admin.ch/rest/services/profile.json', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data.toString())
    }
}, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => console.log(body));
});
req.write(data.toString());
req.end();
