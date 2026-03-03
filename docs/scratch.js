// Test the corrected LV95 -> WGS84 conversion
// Bern = E: 2600000, N: 1200000 -> should give ~46.951°N, ~7.439°E

function lv95ToWgs84(E, N) {
    const y = (E - 2600000) / 1000000;
    const x = (N - 1200000) / 1000000;

    const lat_c = 16.9023892
        + 3.238272 * x
        - 0.270978 * y * y
        - 0.002528 * x * x
        - 0.0447 * y * y * x
        - 0.0140 * x * x * x;

    const lon_c = 2.6779094
        + 4.728982 * y
        + 0.791484 * y * x
        + 0.1306 * y * x * x
        - 0.0436 * y * y * y;

    return {
        lat: (lat_c * 100) / 36,
        lon: (lon_c * 100) / 36
    };
}

// Test 1: Bern (approx E=2600000, N=1200000)
console.log("Bern test:", lv95ToWgs84(2600000, 1200000));
// Expected: {lat: 46.951, lon: 7.439}

// Test 2: Geneva (approx E=2500000, N=1118000)
console.log("Geneva test:", lv95ToWgs84(2500000, 1118000));
// Expected: {lat: ~46.2°N, lon: ~6.15°E}

// Test 3: Zurich (approx E=2683000, N=1248000)
console.log("Zurich test:", lv95ToWgs84(2683000, 1248000));
// Expected: {lat: ~47.38°N, lon: ~8.54°E}
