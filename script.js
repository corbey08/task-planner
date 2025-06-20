// Global variables for data
let turnpoints = [];
let airspaceData = [];

// Global variables
let map;
let selectedTask = [];
let taskLine = null;
let airspaceVisible = false;
let currentMapType = 'carto';
let scoringMethod = 'fai';
let highlightedSearchMarkers = L.layerGroup();
let activeSearchHighlightMarker = null;

let turnpointMarkerMap = new Map();

let airspaceLayer = null;

function parseAltitude(altStr) {
    altStr = altStr.toLowerCase().trim();
    if (altStr.includes('ft')) {
        return parseFloat(altStr.replace('ft', '').trim());
    } else if (altStr.includes('fl')) {
        return parseFloat(altStr.replace('fl', '').trim()) * 100;
    } else if (altStr.includes('m')) {
        return parseFloat(altStr.replace('m', '').trim()) * 3.28084;
    } else if (altStr === 'gnd' || altStr === 'sfc') {
        return 0;
    }
    const num = parseFloat(altStr);
    if (!isNaN(num)) {
        return num;
    }
    return null;
}

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

function loadAirspace() {
    // Initialize airspace layer first
    if (!airspaceLayer) {
        airspaceLayer = L.layerGroup();
    }
    
    fetch('airspace.geojson')
        .then(response => {
            if (!response.ok) {
                console.warn('airspace.geojson not found or network error. Loading sample airspace.');
                createSampleAirspace();
                throw new Error('Network response was not ok ' + response.statusText);
            }
            return response.json();
        })
        .then(geojsonData => {
            // Clear existing airspace data
            if (airspaceLayer) {
                airspaceLayer.clearLayers();
            } else {
                airspaceLayer = L.layerGroup();
            }

            const airspaceStyle = (feature) => {
                const airspaceClass = feature.properties.icaoClass || feature.properties.CLASS;
                return {
                    color: getAirspaceColor(airspaceClass),
                    fillOpacity: 0, // No fill
                    weight: 1.5,
                    opacity: 0.7,
                    interactive: false 
                };
            };

            const onEachAirspaceFeature = (feature, layer) => {
                // 1. Construct the label text
                let name = feature.properties.name || feature.properties.NAME || 'Unnamed Airspace';
                let altitudeText = '';
                if (feature.properties.lowerLimit && feature.properties.upperLimit) {
                    const lowerAlt = formatAltitude(feature.properties.lowerLimit);
                    const upperAlt = formatAltitude(feature.properties.upperLimit);
                    altitudeText = `${lowerAlt} - ${upperAlt}`;
                } else if (feature.properties.AL_UNITS || feature.properties.AH_UNITS) {
                    altitudeText = `${feature.properties.AL_UNITS || 'GND'} - ${feature.properties.AH_UNITS || 'UNL'}`;
                }
                
                const labelText = `${name} | ${altitudeText}`;

                layer.setText(labelText, {
                    center: true,
                    offset: 0,
                    attributes: {
                        'font-size': '12',
                        'class': 'airspace-text-path'
                    }
                });
            };

            const geoJsonLayer = L.geoJSON(geojsonData, {
                style: airspaceStyle,
                onEachFeature: onEachAirspaceFeature
            });

            // Add the GeoJSON layer to our airspace layer group
            airspaceLayer.addLayer(geoJsonLayer);

            // Add to map if airspace should be visible
            if (airspaceVisible && map && !map.hasLayer(airspaceLayer)) {
                airspaceLayer.addTo(map);
            }

            console.log('Airspace GeoJSON loaded and processed.');
        })
        .catch(error => {
            console.error('There was a problem loading the airspace GeoJSON file:', error);
            createSampleAirspace();
        });
}

// Helper function to format altitude from the GeoJSON structure
function formatAltitude(altitudeObj) {
    if (!altitudeObj) return 'N/A';
    
    const value = altitudeObj.value;
    const unit = altitudeObj.unit; // 1 = feet, 2 = meters, etc.
    const referenceDatum = altitudeObj.referenceDatum; // 0 = GND, 1 = MSL, 2 = FL
    
    let altText = '';
    
    if (referenceDatum === 0) {
        altText = value === 0 ? 'GND' : `${value}ft GND`;
    } else if (referenceDatum === 2) {
        altText = `FL${Math.round(value / 100)}`;
    } else {
        altText = `${value}ft`;
    }
    
    return altText;
}

// Helper function to convert ICAO class number to letter
function getClassFromIcaoClass(icaoClass) {
    const classMap = {
        1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F', 7: 'G',
        8: 'Other', 9: 'CTR', 10: 'CTA', 11: 'TMA', 12: 'ATZ'
    };
    return classMap[icaoClass] || 'Unknown';
}

// Function to add text labels along airspace boundaries
function addBoundaryLabel(layer, name, altitudeText) {
    // Get the bounds of the airspace
    const bounds = layer.getBounds();
    const center = bounds.getCenter();
    
    // Create label text
    let labelText = name;
    if (altitudeText) {
        labelText += `\n${altitudeText}`;
    }
    
    // Create a text marker at the center
    const textMarker = L.marker(center, {
        icon: L.divIcon({
            className: 'airspace-label',
            html: `<div class="airspace-text">${labelText.replace('\n', '<br>')}</div>`,
            iconSize: [100, 40],
            iconAnchor: [50, 20]
        })
    });
    
    // Add the text marker to the airspace layer
    airspaceLayer.addLayer(textMarker);
    
    // For polygon boundaries, we can also add labels along the edges
    if (layer instanceof L.Polygon) {
        addPolygonEdgeLabels(layer, name, altitudeText);
    }
}

// Function to add labels along polygon edges
function addPolygonEdgeLabels(polygon, name, altitudeText) {
    const latlngs = polygon.getLatLngs()[0]; // Get the outer ring
    
    if (latlngs.length < 3) return;
    
    // Calculate the perimeter and place labels at intervals
    const numLabels = Math.min(4, Math.max(1, Math.floor(latlngs.length / 8)));
    const interval = Math.floor(latlngs.length / numLabels);
    
    for (let i = 0; i < numLabels; i++) {
        const index = i * interval;
        if (index < latlngs.length - 1) {
            const point1 = latlngs[index];
            const point2 = latlngs[index + 1];
            
            // Calculate midpoint of the edge
            const midLat = (point1.lat + point2.lat) / 2;
            const midLng = (point1.lng + point2.lng) / 2;
            
            // Calculate angle for text rotation
            const angle = Math.atan2(point2.lat - point1.lat, point2.lng - point1.lng) * 180 / Math.PI;
            
            let labelText = name;
            if (altitudeText && i === 0) { // Only show altitude on first label to avoid clutter
                labelText += ` ${altitudeText}`;
            }
            
            const edgeMarker = L.marker([midLat, midLng], {
                icon: L.divIcon({
                    className: 'airspace-edge-label',
                    html: `<div class="airspace-edge-text" style="transform: rotate(${angle}deg)">${labelText}</div>`,
                    iconSize: [120, 20],
                    iconAnchor: [60, 10]
                })
            });
            
            airspaceLayer.addLayer(edgeMarker);
        }
    }
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
    loadAirspace();
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

// Update the getAirspaceColor function to handle the new class system
function getAirspaceColor(airspaceClass) {
    if (typeof airspaceClass === 'number') {
        const classMap = {
            1: '#ff0000', // A
            2: '#ff0000', // B  
            3: '#ff6600', // C
            4: '#0066ff', // D
            5: '#ff00ff', // E
            6: '#ffff00', // F
            7: '#00ff00', // G
            8: '#ff9900', // Other
            9: '#ff0000', // CTR
            10: '#ff6600', // CTA
            11: '#0066ff', // TMA
            12: '#ff00ff'  // ATZ
        };
        return classMap[airspaceClass] || '#ff0000';
    }
    
    const colors = {
        'A': '#ff0000',
        'B': '#ff0000',
        'C': '#ff6600',
        'D': '#0066ff',
        'E': '#ff00ff',
        'F': '#ffff00',
        'G': '#00ff00',
        'CTR': '#ff0000',
        'CTA': '#ff6600',
        'TMA': '#0066ff',
        'ATZ': '#ff00ff'
    };
    return colors[airspaceClass] || '#ff0000';
}
// Add turnpoints to map
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

        // Click handler
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
}

// Create sample airspace zones (fallback to show when import hasn't worked)
function createSampleAirspace() {
    const airspaceZones = [{
            name: "London TMA",
            bounds: [
                [51.3, -0.8],
                [51.7, 0.3]
            ],
            type: "TMA"
        },
        {
            name: "Manchester CTA",
            bounds: [
                [53.2, -2.6],
                [53.6, -2.0]
            ],
            type: "CTA"
        },
        {
            name: "Birmingham ATZ",
            bounds: [
                [52.4, -1.8],
                [52.5, -1.6]
            ],
            type: "ATZ"
        },
        {
            name: "Edinburgh CTA",
            bounds: [
                [55.8, -3.5],
                [56.0, -3.1]
            ],
            type: "CTA"
        },
        {
            name: "Bristol CTA",
            bounds: [
                [51.3, -2.8],
                [51.5, -2.4]
            ],
            type: "CTA"
        }
    ];

    // Clear existing airspace data
    if (airspaceLayer) {
        airspaceLayer.clearLayers();
    } else {
        airspaceLayer = L.layerGroup();
    }

    airspaceZones.forEach(zone => {
        const rectangle = L.rectangle(zone.bounds, {
            color: getAirspaceColor(zone.type),
            fillColor: getAirspaceColor(zone.type),
            fillOpacity: 0.3,
            weight: 2
        }).bindPopup(`<b>${zone.name}</b><br>Type: ${zone.type}`);

        airspaceLayer.addLayer(rectangle);
    });

    // Add to map if airspace should be visible and map exists
    if (airspaceVisible && map && !map.hasLayer(airspaceLayer)) { 
        airspaceLayer.addTo(map);
    }
    
    console.log('Sample airspace created and loaded.');
}

// Toggle airspace visibility
function toggleAirspace() {
    if (!airspaceLayer) {
        console.warn('Airspace layer not initialized. Creating sample airspace.');
        createSampleAirspace();
        return;
    }

    if (airspaceVisible && map.hasLayer(airspaceLayer)) {
        map.removeLayer(airspaceLayer);
        airspaceVisible = false;
        console.log('Airspace hidden');
    } else {
        airspaceLayer.addTo(map);
        airspaceVisible = true;
        console.log('Airspace shown');
    }
}

// Switch between map types
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

// Set scoring method
function setScoringMethod(method) {
    scoringMethod = method;

    document.querySelectorAll('.scoring-option').forEach(option => {
        option.classList.remove('active');
    });
    event.target.classList.add('active');

    updateTaskDisplay();
}

// Add point to task
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
        if (index > 0) {
            const prevPoint = selectedTask[index - 1];
            const segmentDistance = calculateDistance(
                prevPoint.lat, prevPoint.lon,
                point.lat, point.lon
            );
            totalDistance += segmentDistance;
        }

        const pointType = index === 0 ? 'Start' :
            index === selectedTask.length - 1 ? 'Finish' :
            `TP${index}`;

        html += `
                    <div class="task-point" data-index="${index}">
                        <div class="task-point-info">
                            <div class="task-point-name">${pointType}: ${point.name}</div>
                            <div class="task-point-code">${point.code}</div>
                        </div>
                        <div class="task-point-actions">
                            <button class="replace-point" onclick="openReplaceDialog(${index})" title="Replace this turnpoint">⟳</button>
                            <button class="remove-point" onclick="removeFromTask(${index})" title="Remove this turnpoint">×</button>
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

// Remove point from task
function removeFromTask(index) {
    selectedTask.splice(index, 1);
    updateTaskDisplay();
    updateTaskLine();
    updateTaskMarkers();
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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

// Clear task
function clearTask() {
    selectedTask = [];
    updateTaskDisplay();
    updateTaskLine();
    updateTaskMarkers();
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
            opacity: 1,
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

window.onload = function() {
    initMap();
};
