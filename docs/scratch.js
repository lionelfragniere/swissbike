// Test: Swisstopo TLM3D identify API with different envelopes and coords
// Aigle: E~2563700, N~1127450 - definitely has roads

const https = require('https');

async function identify(E, N, hs) {
    return new Promise((resolve, reject) => {
        const VIEW_HALF = 2000;
        const params = new URLSearchParams({
            geometryType: 'esriGeometryEnvelope',
            geometry: `${E - hs},${N - hs},${E + hs},${N + hs}`,
            layers: 'all:ch.swisstopo.swisstlm3d-strassen',
            sr: '2056',
            tolerance: '0',
            mapExtent: `${E - VIEW_HALF},${N - VIEW_HALF},${E + VIEW_HALF},${N + VIEW_HALF}`,
            imageDisplay: '1000,1000,96',
            returnGeometry: 'false',
            lang: 'fr'
        });
        const url = `https://api3.geo.admin.ch/rest/services/ech/MapServer/identify?${params}`;
        https.get(url, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => resolve(JSON.parse(body)));
        }).on('error', reject);
    });
}

(async () => {
    // Try multiple known road points
    const points = [
        { name: 'Aigle center', E: 2563700, N: 1127450 },
        { name: 'Monthey', E: 2558000, N: 1118000 },
        { name: 'Bern center', E: 2600000, N: 1199900 },
    ];

    for (const pt of points) {
        console.log(`\n=== ${pt.name} ===`);
        for (const hs of [5, 20, 100]) {
            const data = await identify(pt.E, pt.N, hs);
            const results = data.results || [];
            console.log(`  hs=${hs}: ${results.length} results`);
            if (results.length > 0) {
                const attrs = results[0].attributes || results[0].properties || {};
                console.log('  Attributes:', JSON.stringify(attrs));
                break;
            }
        }
    }
})();
