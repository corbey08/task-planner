let turnpoints = [];

let map;
let selectedTask = [];
let taskLine = null;
let currentMapType = 'carto';
let scoringMethod = 'fai';
let highlightedSearchMarkers = L.layerGroup();
let activeSearchHighlightMarker = null;

// Airspace variables
let airspaceVisible = false;
let airspaceLayer = null;
const OPENAIP_API_KEY = 'd9433bd4bd4e5d2b7e70bbd51163a2af';
let turnpointMarkerMap = new Map();

function degToRad(deg) {
    return deg * Math.PI / 180;
}

function generateArcPoints(startLatLng, endLatLng, centerLatLng, direction) {
    const arcPoints = [];
    const numSegments = 50;

    const start = L.latLng(startLatLng[0], startLatLng[1]);
    const end = L.latLng(endLatLng[0], endLatLng[1]);
    const center = L.latLng(centerLatLng[0], centerLatLng[1]);

    const radiusMeters = center.distanceTo(start);

    const getBearing = (p1, p2) => {
        const dLon = p2.lng - p1.lng;
        const dLat = p2.lat - p1.lat;
        const avgLatRad = degToRad((p1.lat + p2.lat) / 2);
        return Math.atan2(dLon * Math.cos(avgLatRad), dLat);
    };

    let startBearing = getBearing(center, start);
    let endBearing = getBearing(center, end);

    if (startBearing < 0) startBearing += 2 * Math.PI;
    if (endBearing < 0) endBearing += 2 * Math.PI;

    let sweepAngle;
    if (direction === '+') {
        sweepAngle = endBearing - startBearing;
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
    } else {
        sweepAngle = startBearing - endBearing;
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI;
        sweepAngle = -sweepAngle;
    }

    for (let i = 0; i <= numSegments; i++) {
        const t = i / numSegments;
        const currentBearing = startBearing + sweepAngle * t;

        const metersPerDegreeLat = 111319;
        const metersPerDegreeLonAtLat = metersPerDegreeLat * Math.cos(degToRad(center.lat));

        const latOffset = (radiusMeters / metersPerDegreeLat) * Math.sin(currentBearing);
        const lonOffset = (radiusMeters / metersPerDegreeLonAtLat) * Math.cos(currentBearing);

        const newLat = center.lat + latOffset;
        const newLon = center.lng + lonOffset;

        arcPoints.push([newLat, newLon]);
    }
    return arcPoints;
}

function loadTurnpoints() {
    fetch('turnpoints.cup')
        .then(response => {
            if (!response.ok) {
                console.warn('turnpoints.cup not found or network error. Loading sample turnpoints.');
                turnpoints = getSampleTurnpoints();
                addTurnpointsToMap();
                throw new Error('Network response was not ok ' + response.statusText);
            }
            return response.text();
        })
        .then(data => {
            turnpoints = parseCUPFile(data);
            if (turnpoints.length === 0) {
                console.warn('No turnpoints parsed from turnpoints.cup. Loading sample turnpoints.');
                turnpoints = getSampleTurnpoints();
            }
            addTurnpointsToMap();
        })
        .catch(error => {
            console.error('There was a problem loading the turnpoints file:', error);
            turnpoints = getSampleTurnpoints();
            addTurnpointsToMap();
        });
}

function getSampleTurnpoints() {
    return [
        { name: "Lasham", code: "LAS", lat: 51.1869, lon: -1.0334, description: "Lasham Airfield" },
        { name: "Booker", code: "BOO", lat: 51.6153, lon: -0.8085, description: "Wycombe Air Park" },
        { name: "Dunstable", code: "DUN", lat: 51.8831, lon: -0.5436, description: "London Gliding Club" },
        { name: "Ridgewell", code: "RID", lat: 52.0053, lon: 0.5097, description: "Ridgewell Airfield" },
        { name: "Gransden", code: "GRA", lat: 52.1831, lon: -0.1917, description: "Gransden Lodge" },
        { name: "Sutton Bank", code: "SUT", lat: 54.2667, lon: -1.2167, description: "Yorkshire Gliding Club" }
    ];
}

function initMap() {
    map = L.map('map').setView([54.5, -3.0], 6);

    const cartoLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    });

    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
        maxZoom: 20
    });

    map.cartoLayer = cartoLayer;
    map.satelliteLayer = satelliteLayer;

    cartoLayer.addTo(map);
    highlightedSearchMarkers.addTo(map);

    loadTurnpoints();
}

// Airspace functions
function toggleAirspace() {
    if (airspaceVisible) {
        hideAirspace();
    } else {
        showAirspace();
    }
}

function showAirspace() {
    if (airspaceLayer) {
        map.addLayer(airspaceLayer);
        airspaceVisible = true;
        updateAirspaceButton();
        return;
    }

    // Use OpenAIP's new TMS tile service (v2 API)
    airspaceLayer = L.tileLayer('https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=' + OPENAIP_API_KEY, {
        attribution: '© openAIP',
        opacity: 0.7,
        transparent: true
    });

    map.addLayer(airspaceLayer);
    airspaceVisible = true;
    updateAirspaceButton();
}

function hideAirspace() {
    if (airspaceLayer) {
        map.removeLayer(airspaceLayer);
    }
    airspaceVisible = false;
    updateAirspaceButton();
}

function createAirspaceLayer(airspaceData) {
    if (airspaceLayer) {
        map.removeLayer(airspaceLayer);
    }
    
    airspaceLayer = L.layerGroup();
    
    if (!airspaceData.items || airspaceData.items.length === 0) {
        console.log('No airspace data available for current view');
        return;
    }
    
    airspaceData.items.forEach(airspace => {
        if (airspace.geometry && airspace.geometry.coordinates) {
            const airspacePolygon = createAirspacePolygon(airspace);
            if (airspacePolygon) {
                airspaceLayer.addLayer(airspacePolygon);
            }
        }
    });
}


function createAirspacePolygon(airspace) {
    try {
        const coordinates = airspace.geometry.coordinates;
        let latlngs = [];
        
        // Handle different geometry types
        if (airspace.geometry.type === 'Polygon') {
            // For polygons, coordinates[0] contains the outer ring
            latlngs = coordinates[0].map(coord => [coord[1], coord[0]]); // [lng, lat] to [lat, lng]
        } else if (airspace.geometry.type === 'MultiPolygon') {
            // For multipolygons, take the first polygon
            latlngs = coordinates[0][0].map(coord => [coord[1], coord[0]]);
        } else {
            console.log('Unsupported geometry type:', airspace.geometry.type);
            return null;
        }
        
        // Get airspace color based on type and lower limit
        const style = getAirspaceStyle(airspace.type, airspace.activity, airspace.lowerLimit);
        
        const polygon = L.polygon(latlngs, style);
        
        // Create popup content
        const popupContent = `
            <div class="airspace-popup">
                <h4>${airspace.name || 'Unnamed Airspace'}</h4>
                <p><strong>Type:</strong> ${airspace.type || 'Unknown'}</p>
                <p><strong>Activity:</strong> ${airspace.activity || 'Unknown'}</p>
                <p><strong>Lower Limit:</strong> ${airspace.lowerLimit?.value || 'Unknown'} ${airspace.lowerLimit?.unit || ''}</p>
                <p><strong>Upper Limit:</strong> ${airspace.upperLimit?.value || 'Unknown'} ${airspace.upperLimit?.unit || ''}</p>
                ${airspace.country ? `<p><strong>Country:</strong> ${airspace.country}</p>` : ''}
            </div>
        `;
        
        polygon.bindPopup(popupContent);
        
        return polygon;
    } catch (error) {
        console.error('Error creating airspace polygon:', error, airspace);
        return null;
    }
}

function getAirspaceStyle(type, activity, lowerLimit) {
    // Clean styling to match openAIP website
    const baseStyle = {
        weight: 1.5,        // Thin borders like their site
        opacity: 0.9,       // High opacity for borders
        fillOpacity: 0.1,   // Default subtle fill
        dashArray: null
    };

    // Simplified color scheme matching openAIP
    const colors = {
        'CTR': '#FF0000',
        'TMA': '#FF4500', 
        'CTA': '#FF8C00',
        'P': '#8B0000',
        'R': '#DC143C',
        'D': '#B22222',
        'ATZ': '#FF0000',    // Air Traffic Zone
        'default': '#666666'
    };

    // Check if airspace is prohibited for gliders from ground level
    const isProhibitedFromGround = isProhibitedAirspaceFromGround(type, lowerLimit);
    
    return {
        ...baseStyle,
        color: colors[type] || colors.default,
        fillColor: isProhibitedFromGround ? '#FF0000' : (colors[type] || colors.default),
        fillOpacity: isProhibitedFromGround ? 0.75 : 0.4  // More visible fill for prohibited areas
    };
}

function isProhibitedAirspaceFromGround(type, lowerLimit) {
    // List of airspace types that are typically prohibited for gliders
    const prohibitedTypes = ['P', 'R', 'D', 'ATZ', 'CTR'];
    
    // Check if it's a prohibited type
    if (!prohibitedTypes.includes(type)) {
        return false;
    }
    
    // Check if lower limit indicates ground level
    if (!lowerLimit || !lowerLimit.value) {
        return false;
    }
    
    const lowerValue = lowerLimit.value.toString().toLowerCase();
    const lowerUnit = lowerLimit.unit ? lowerLimit.unit.toLowerCase() : '';
    
    // Check for ground level indicators
    const groundLevelIndicators = [
        'gnd', 'ground', 'sfc', 'surface', '0', 'agl'
    ];
    
    // Check if lower limit is at ground level
    const isGroundLevel = groundLevelIndicators.some(indicator => 
        lowerValue.includes(indicator) || 
        (lowerValue === '0' && (lowerUnit.includes('ft') || lowerUnit.includes('m')))
    );
    
    return isGroundLevel;
}

function updateAirspaceButton() {
    const button = document.getElementById('toggleAirspaceBtn');
    if (button) {
        button.textContent = airspaceVisible ? 'Hide Airspace' : 'Show Airspace';
        button.classList.toggle('active', airspaceVisible);
    }
}

// Add event listener to reload airspace when map moves significantly
function setupAirspaceReloading() {
    let lastBounds = null;
    
    map.on('moveend', () => {
        if (!airspaceVisible) return;
        
        const currentBounds = map.getBounds();
        
        // Check if we've moved significantly
        if (!lastBounds || !currentBounds.intersects(lastBounds)) {
            console.log('Map moved significantly, reloading airspace...');
            showAirspace(); // This will reload the airspace for new bounds
        }
        
        lastBounds = currentBounds;
    });
}

function parseCUPFile(content) {
    const lines = content.split('\n');
    const points = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('name,code') && !line.startsWith('-----')) {
            const parts = line.split(',');
            if (parts.length >= 5) {
                const name = parts[0].replace(/"/g, '');
                const code = parts[1].replace(/"/g, '');
                const country = parts[2].replace(/"/g, '');
                const latStr = parts[3].replace(/"/g, '');
                const lonStr = parts[4].replace(/"/g, '');
                
                const lat = parseCoordinate(latStr);
                const lon = parseCoordinate(lonStr);
                
                if (!isNaN(lat) && !isNaN(lon)) {
                    points.push({
                        name: name,
                        code: code,
                        country: country,
                        lat: lat,
                        lon: lon,
                        description: parts.length > 10 ? parts[10].replace(/"/g, '') : ''
                    });
                }
            }
        }
    }
    
    return points;
}

function parseCoordinate(coordStr) {
    coordStr = coordStr.replace(/"/g, '').trim();

    if (!isNaN(parseFloat(coordStr)) && !coordStr.match(/[NSEW]/i)) {
        return parseFloat(coordStr);
    }

    const ddmMatch = coordStr.match(/^(\d{1,3})(\d{2}\.\d+)([NSEW])$/i);
    if (ddmMatch) {
        const degrees = parseInt(ddmMatch[1], 10);
        const minutes = parseFloat(ddmMatch[2]);
        const direction = ddmMatch[3].toUpperCase();

        let decimal = degrees + (minutes / 60);
        if (direction === 'S' || direction === 'W') {
            decimal = -decimal;
        }
        return decimal;
    }

    const dmsMatch = coordStr.match(/(\d+):(\d+):(\d+)([NSEW])/);
    if (dmsMatch) {
        const degrees = parseInt(dmsMatch[1]);
        const minutes = parseInt(dmsMatch[2]);
        const seconds = parseInt(dmsMatch[3]);
        const direction = dmsMatch[4];

        let decimal = degrees + minutes / 60 + seconds / 3600;
        if (direction === 'S' || direction === 'W') {
            decimal = -decimal;
        }
        return decimal;
    }

    console.warn(`Could not parse coordinate: ${coordStr}`);
    return NaN;
}

function addTurnpointsToMap() {
    turnpointMarkerMap.forEach(marker => map.removeLayer(marker));
    turnpointMarkerMap.clear();

    turnpoints.forEach(point => {
        const marker = L.circleMarker([point.lat, point.lon], {
            radius: 6,
            fillColor: '#3388ff',
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        });

        const tooltipContent = `<b>${point.name}</b><br>Code: ${point.code}<br>${point.description}`;
        marker.bindTooltip(tooltipContent, {
            permanent: false,
            direction: 'top',
            offset: [0, -10]
        });

        marker.turnpointData = point;

        marker.on('click', (e) => {
            const clickedPoint = e.target.turnpointData;
            console.log(`Clicked on ${clickedPoint.name} (${clickedPoint.code})`);
            console.log('Current task length:', selectedTask.length);

            if (selectedTask.length > 0) {
                const lastPoint = selectedTask[selectedTask.length - 1];
                console.log('Last point in task:', lastPoint.code);

                if (lastPoint.code === clickedPoint.code) {
                    console.log('Preventing consecutive duplicate');
                    return;
                }
            }

            console.log('Adding point to task');
            addToTask(clickedPoint);
        });

        marker.addTo(map);
        turnpointMarkerMap.set(point.code, marker);
    });

    updateTaskMarkers();
    
    // Setup airspace reloading after map is initialized
    setupAirspaceReloading();
}

function switchMapType() {
    if (currentMapType === 'carto') {
        map.removeLayer(map.cartoLayer);
        map.addLayer(map.satelliteLayer);
        currentMapType = 'satellite';
    } else {
        map.removeLayer(map.satelliteLayer);
        map.addLayer(map.cartoLayer);
        currentMapType = 'carto';
    }
}

function setScoringMethod(method) {
    scoringMethod = method;

    document.querySelectorAll('.scoring-option').forEach(option => {
        option.classList.remove('active');
    });

    const clickedOption = document.querySelector(`.scoring-option[onclick*="${method}"]`);
    if (clickedOption) {
        clickedOption.classList.add('active');
    }

    updateTaskDisplay();
}

function addToTask(point) {
    console.log(`Adding ${point.name} to task`);
    selectedTask.push(point);
    updateTaskDisplay();
    updateTaskLine();
    updateTaskMarkers();
}

function updateTaskDisplay() {
    const taskListDiv = document.getElementById('taskList');

    if (selectedTask.length === 0) {
        taskListDiv.innerHTML = '<div class="empty-task">Click on turnpoints on the map to start building your task</div>';
        document.getElementById('totalDistance').textContent = '0.0';
        return;
    }

    let html = '';
    let totalDistance = 0;

    selectedTask.forEach((point, index) => {
        let segmentDistance = 0;
        let bearing = 0;
        let distanceBearingHtml = '';

        if (index > 0) {
            const prevPoint = selectedTask[index - 1];
            segmentDistance = calculateDistance(
                prevPoint.lat, prevPoint.lon,
                point.lat, point.lon
            );
            bearing = calculateBearing(
                prevPoint.lat, prevPoint.lon,
                point.lat, point.lon
            );
            totalDistance += segmentDistance;
            
            distanceBearingHtml = `
                <div class="task-point-leg">
                    ${segmentDistance.toFixed(1)}km @ ${formatBearing(bearing)}°
                </div>
            `;
        }

        const pointType = index === 0 ? 'Start' :
            index === selectedTask.length - 1 ? 'Finish' :
            `TP${index}`;

        html += `
            <div class="task-point" data-index="${index}">
                <div class="task-point-info">
                    <div class="task-point-name">${pointType}: ${point.name}</div>
                    <div class="task-point-code">${point.code}</div>
                    ${index > 0 ? `<div class="task-point-leg">${segmentDistance.toFixed(1)}km @ ${formatBearing(bearing)}°</div>` : ''}
                </div>
                <div class="task-point-actions">
                    <button class="replace-point" onclick="openReplaceDialog(${index})" title="Replace this turnpoint">⇄</button>
                    <button class="remove-point" onclick="removeFromTask(${index})" title="Remove this turnpoint">x</button>
                </div>
            </div>
            <div id="replaceDialog-${index}" class="replace-dialog">
                <input type="text" placeholder="New turnpoint name/code" class="replace-input" id="replaceInput-${index}" list="turnpointSuggestions">
                <datalist id="turnpointSuggestions"></datalist>
                <button onclick="confirmReplace(${index})">OK</button>
                <button onclick="cancelReplace(${index})">Cancel</button>
            </div>
        `;
    });

    if (scoringMethod === 'barrels' && selectedTask.length > 2) {
        const intermediateTurnpoints = selectedTask.length - 2;
        const totalReduction = intermediateTurnpoints * 1.0;
        totalDistance = Math.max(0, totalDistance - totalReduction);
    }

    taskListDiv.innerHTML = html;
    document.getElementById('totalDistance').textContent = totalDistance.toFixed(1);

    const faiValidation = document.getElementById('faiValidation');
    if (selectedTask.length >= 3) {
        const isValid = validateFAI28Rule(selectedTask);
        faiValidation.style.display = 'block';
        faiValidation.innerHTML = isValid ? 
            '<span style="color: chartreuse;">✓ Task meets FAI 28% triangle rule</span>' : 
            '<span style="color: white;"></span>';
    } else {
        faiValidation.style.display = 'none';
    }

    selectedTask.forEach((point, index) => {
        const dialog = document.getElementById(`replaceDialog-${index}`);
        if (dialog) dialog.style.display = 'none';

        const input = document.getElementById(`replaceInput-${index}`);
        if (input) {
            input.oninput = (e) => updateDatalist(e.target.value);

            input.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmReplace(index);
                }
            };
        }
    });
}

function removeFromTask(index) {
    selectedTask.splice(index, 1);
    updateTaskDisplay();
    updateTaskLine();
    updateTaskMarkers();

    const faiValidation = document.getElementById('faiValidation');
    if (selectedTask.length < 3) {
        faiValidation.style.display = 'none';
    }
}

function calculateDistanceVincenty(lat1, lon1, lat2, lon2) {
    const a = 6378137;
    const b = 6356752.314245;
    const f = 1 / 298.257223563;
    
    const L = (lon2 - lon1) * Math.PI / 180; 
    const U1 = Math.atan((1 - f) * Math.tan(lat1 * Math.PI / 180));
    const U2 = Math.atan((1 - f) * Math.tan(lat2 * Math.PI / 180));
    
    const sinU1 = Math.sin(U1);
    const cosU1 = Math.cos(U1);
    const sinU2 = Math.sin(U2);
    const cosU2 = Math.cos(U2);
    
    let lambda = L;
    let lambdaP;
    let iterLimit = 100;
    let cos2SigmaM, sinSigma, cosSigma, sigma, sinLambda, cosLambda, sinAlpha, cosSqAlpha;
    
    do {
        sinLambda = Math.sin(lambda);
        cosLambda = Math.cos(lambda);
        sinSigma = Math.sqrt((cosU2 * sinLambda) * (cosU2 * sinLambda) +
            (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda));
        
        if (sinSigma === 0) return 0;
        
        cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
        sigma = Math.atan2(sinSigma, cosSigma);
        sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
        cosSqAlpha = 1 - sinAlpha * sinAlpha;
        cos2SigmaM = cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;
        
        if (isNaN(cos2SigmaM)) cos2SigmaM = 0;
        
        const C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
        lambdaP = lambda;
        lambda = L + (1 - C) * f * sinAlpha *
            (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    } while (Math.abs(lambda - lambdaP) > 1e-12 && --iterLimit > 0);
    
    if (iterLimit === 0) {
        console.warn('Vincenty formula failed to converge, using Haversine');
        return calculateDistanceHaversine(lat1, lon1, lat2, lon2);
    }
    
    const uSq = cosSqAlpha * (a * a - b * b) / (b * b);
    const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    const deltaSigma = B * sinSigma * (cos2SigmaM + B / 4 * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
        B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    
    const s = b * A * (sigma - deltaSigma);
    
    return s / 1000;
}

// fallback
function calculateDistanceHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    return calculateDistanceVincenty(lat1, lon1, lat2, lon2);
}

function updateTaskLine() {
    if (taskLine) {
        map.removeLayer(taskLine);
    }

    if (selectedTask.length > 1) {
        const latlngs = selectedTask.map(point => [point.lat, point.lon]);
        taskLine = L.polyline(latlngs, {
            color: '#ff0000',
            weight: 3,
            opacity: 0.7,
            dashArray: '5, 5'
        }).addTo(map);
    }
}

function updateTaskMarkers() {
    turnpointMarkerMap.forEach(marker => {
        marker.setStyle({
            radius: 6,
            fillColor: '#3388ff',
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        });
    });

    selectedTask.forEach((point, index) => {
        const marker = turnpointMarkerMap.get(point.code);
        if (marker) {
            let markerColor = '#ff3333';
            let markerSize = 8;

            if (index === 0) {
                markerColor = '#00ff00';
                markerSize = 10;
            } else if (index === selectedTask.length - 1) {
                markerColor = '#ff0000';
                markerSize = 10;
            }

            marker.setStyle({
                radius: markerSize,
                fillColor: markerColor,
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.9
            });

            marker.bindPopup(`<b>Task Point ${index + 1}</b><br>${point.name} (${point.code})`);
        }
    });
}

function clearTask() {
    selectedTask = [];
    updateTaskDisplay();
    updateTaskLine();
    updateTaskMarkers();
    document.getElementById('faiValidation').style.display = 'none';
}

function openReplaceDialog(index) {
    selectedTask.forEach((_, i) => {
        const dialog = document.getElementById(`replaceDialog-${i}`);
        if (dialog) dialog.style.display = 'none';
    });

    const dialog = document.getElementById(`replaceDialog-${index}`);
    if (dialog) {
        dialog.style.display = 'flex';
        const input = document.getElementById(`replaceInput-${index}`);
        if (input) {
            input.value = '';
            input.focus();
            updateDatalist('');
        }
    }
}

function cancelReplace(index) {
    const dialog = document.getElementById(`replaceDialog-${index}`);
    if (dialog) dialog.style.display = 'none';
    const input = document.getElementById(`replaceInput-${index}`);
    if (input) input.value = '';
    const datalist = document.getElementById('turnpointSuggestions');
    if (datalist) datalist.innerHTML = '';
}

function updateDatalist(searchTerm) {
    const datalist = document.getElementById('turnpointSuggestions');
    if (!datalist) return;

    datalist.innerHTML = '';
    const lowerSearchTerm = searchTerm.toLowerCase();

    turnpoints.filter(point =>
        point.name.toLowerCase().includes(lowerSearchTerm) ||
        point.code.toLowerCase().includes(lowerSearchTerm)
    ).slice(0, 20).forEach(point => {
        const option = document.createElement('option');
        option.value = `${point.name} (${point.code})`;
        datalist.appendChild(option);
    });
}

function confirmReplace(index) {
    const input = document.getElementById(`replaceInput-${index}`);
    const newPointIdentifier = input.value.trim();

    if (!newPointIdentifier) {
        alert('Please enter a turnpoint name or code.');
        return;
    }

    const newPoint = turnpoints.find(point =>
        point.name.toLowerCase() === newPointIdentifier.toLowerCase() ||
        point.code.toLowerCase() === newPointIdentifier.toLowerCase() ||
        `${point.name} (${point.code})`.toLowerCase() === newPointIdentifier.toLowerCase()
    );

    if (newPoint) {
        if (selectedTask[index] && selectedTask[index].code === newPoint.code) {
            console.log("Replacing with the same turnpoint. No change made.");
            cancelReplace(index);
            return;
        }

        selectedTask[index] = newPoint;
        updateTaskDisplay();
        updateTaskLine();
        updateTaskMarkers();
        cancelReplace(index);
    } else {
        alert('Turnpoint not found. Please enter a valid turnpoint name or code from the list or full name/code.');
    }
}

function highlightAndPanToTurnpoint(point) {
    if (activeSearchHighlightMarker) {
        activeSearchHighlightMarker.remove();
        activeSearchHighlightMarker = null;
    }

    const originalMarker = turnpointMarkerMap.get(point.code);

    if (originalMarker) {
        const highlightRadius = 15;
        const highlightCircle = L.circleMarker([point.lat, point.lon], {
            radius: highlightRadius,
            fillColor: '#ffa500',
            color: '#fff',
            weight: 3,
            opacity: 0.5,
            fillOpacity: 0.5,
            className: 'search-highlight-marker'
        });

        highlightCircle.turnpointData = point;

        highlightCircle.on('click', (e) => {
            const clickedPoint = e.target.turnpointData;
            addToTask(clickedPoint);

            e.target.remove();
            activeSearchHighlightMarker = null;

            document.getElementById('searchInput').value = '';
            document.getElementById('searchResults').innerHTML = '';
        });

        highlightCircle.addTo(map);
        activeSearchHighlightMarker = highlightCircle;

        map.flyTo([point.lat, point.lon], 12);
        originalMarker.openTooltip();
    }
}

function searchTurnpoints() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const searchResultsDiv = document.getElementById('searchResults');
    searchResultsDiv.innerHTML = '';

    if (searchTerm.length === 0) {
        if (activeSearchHighlightMarker) {
            activeSearchHighlightMarker.remove();
            activeSearchHighlightMarker = null;
        }
        return;
    }

    if (searchTerm.length < 2) {
        return;
    }

    const matchedTurnpoints = turnpoints.filter(point =>
        point.name.toLowerCase().includes(searchTerm) ||
        point.code.toLowerCase().includes(searchTerm)
    );

    if (matchedTurnpoints.length === 0) {
        searchResultsDiv.innerHTML = '<div class="empty-task">No results found.</div>';
        return;
    }

    matchedTurnpoints.forEach(point => {
        const resultItem = document.createElement('div');
        resultItem.classList.add('search-result-item');
        resultItem.innerHTML = `<span>${point.name}</span> <span class="result-code">${point.code}</span>`;

        resultItem.onclick = () => {
            highlightAndPanToTurnpoint(point);
            document.getElementById('searchResults').innerHTML = '';
            document.getElementById('searchInput').value = point.name;
        };
        searchResultsDiv.appendChild(resultItem);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', () => {
        if (searchInput.value.length === 0 && activeSearchHighlightMarker) {
            activeSearchHighlightMarker.remove();
            activeSearchHighlightMarker = null;
        }
    });
});

function refreshAirspace() {
    if (airspaceVisible && airspaceLayer) {
        console.log('Refreshing airspace data...');
        hideAirspace();
        showAirspace();
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleIcon = document.querySelector('.toggle-icon');

    sidebar.classList.toggle('collapsed');

    const isMobile = window.innerWidth <= 768;

    if (sidebar.classList.contains('collapsed')) {
        toggleIcon.textContent = isMobile ? '▲' : '▶';
    } else {
        toggleIcon.textContent =isMobile ? '▼' : '◀';
    }

    setTimeout(() => {
        if (typeof map !== 'undefined') {
            map.invalidateSize();
        }
    },300);
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    bearing = (bearing + 360) % 360; 
    
    return bearing;
}

function formatBearing(bearing) {
    return Math.round(bearing).toString().padStart(3, '0');
}

//TODO add more detailed validation once exact rules are confirmed
function validateFAI28Rule(task) {
    if (task.length < 4) return false;
    if (task.length > 6) return false;
    
    // Check that start and finish turnpoints are the same
    const startCode = task[0].code;
    const finishCode = task[task.length - 1].code;
    if (startCode !== finishCode) {
        return false;
    }
    
    // Check for duplicate turnpoints (excluding start/finish being the same)
    const turnpointCodes = task.map(point => point.code);
    
    // Check middle turnpoints for duplicates
    const middleTurnpoints = turnpointCodes.slice(1, -1); // Exclude start and finish
    const uniqueMiddleTurnpoints = [...new Set(middleTurnpoints)];
    
    // If there are duplicates in middle turnpoints, task is invalid
    if (middleTurnpoints.length !== uniqueMiddleTurnpoints.length) {
        return false;
    }
    
    // Check if any middle turnpoint is the same as start or finish
    for (const middleCode of middleTurnpoints) {
        if (middleCode === startCode) {
            return false;
        }
    }
    
    let totalDistance = 0;
    let legDistances = [];
    
    // Calculate all leg distances
    for (let i = 1; i < task.length; i++) {
        const prevPoint = task[i - 1];
        const currentPoint = task[i];
        const distance = calculateDistance(
            prevPoint.lat, prevPoint.lon,
            currentPoint.lat, currentPoint.lon
        );
        legDistances.push(distance);
        totalDistance += distance;
    }
    
    // Find shortest leg
    const shortestLeg = Math.min(...legDistances);
    
    // Check if shortest leg is at least 28% of total
    return (shortestLeg / totalDistance) >= 0.28;
}

window.addEventListener('resize', () => {
    const sidebar = document.getElementById('sidebar');
    const toggleIcon = document.querySelector('.toggle-icon');
    const isMobile = window.innerWidth <= 768;
    
    if (sidebar.classList.contains('collapsed')) {
        toggleIcon.textContent = isMobile ? '▲' : '▶';
    } else {
        toggleIcon.textContent = isMobile ? '▼' : '◀';
    }
});

setInterval(refreshAirspace, 30 * 60 * 1000);

window.onload = function() {
    initMap();
};
