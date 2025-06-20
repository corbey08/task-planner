// Global variables for data
let turnpoints = [];
let airspaceData = []; // Not strictly needed if processing directly into layerGroup

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

let airspaceLayer = null; // This will hold all airspace features and their labels

// --- Helper Functions (Keep these as they are) ---
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

// --- Modified loadAirspace and new addAirspaceLabel functions ---
function loadAirspace() {
    // Initialize airspace layer if it doesn't exist
    if (!airspaceLayer) {
        airspaceLayer = L.layerGroup();
    }
    
    fetch('airspace.geojson')
        .then(response => {
            if (!response.ok) {
                console.warn('airspace.geojson not found or network error. Loading sample airspace.');
                createSampleAirspace(); // Fallback to sample
                throw new Error('Network response was not ok ' + response.statusText);
            }
            return response.json();
        })
        .then(geojsonData => {
            // Clear existing airspace data from the layer group
            airspaceLayer.clearLayers();

            const airspaceStyle = (feature) => {
                const airspaceClass = feature.properties.icaoClass || feature.properties.CLASS;
                return {
                    color: getAirspaceColor(airspaceClass),
                    fillColor: getAirspaceColor(airspaceClass), // Add fill color
                    fillOpacity: 0.1, // Semi-transparent fill
                    weight: 1.5,
                    opacity: 0.7,
                    interactive: false // IMPORTANT: Ensures turnpoints below are clickable
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
                
                const labelText = `${name}<br><small>${altitudeText}</small>`; // Use <br> for new line, <small> for smaller altitude text

                // Add label for Polygon and LineString features
                if (layer instanceof L.Polygon || layer instanceof L.Polyline) {
                    addAirspaceLabel(layer, labelText);
                }
                // For other geometry types (e.g., Point), no label will be added by this logic
            };

            const geoJsonLayer = L.geoJSON(geojsonData, {
                style: airspaceStyle,
                onEachFeature: onEachAirspaceFeature
            });

            // Add the GeoJSON layer to our airspace layer group
            // This adds all the polygons/lines AND their associated divIcon labels (added in onEachFeature)
            airspaceLayer.addLayer(geoJsonLayer);

            // Add to map if airspace should be visible
            if (airspaceVisible && map && !map.hasLayer(airspaceLayer)) {
                airspaceLayer.addTo(map);
            }

            console.log('Airspace GeoJSON loaded and processed.');
        })
        .catch(error => {
            console.error('There was a problem loading the airspace GeoJSON file:', error);
            createSampleAirspace(); // Fallback to sample
        });
}

/**
 * Adds a custom HTML label (L.divIcon marker) to an airspace layer.
 * This is a general function for both Polygons and Polylines.
 * @param {L.Layer} layer The Leaflet layer (Polygon or Polyline) to label.
 * @param {string} labelText The HTML content for the label.
 */
function addAirspaceLabel(layer, labelText) {
    let center;
    if (layer instanceof L.Polygon) {
        // For polygons, use the geographical center of the polygon
        center = layer.getBounds().getCenter();
    } else if (layer instanceof L.Polyline) {
        // For polylines, use the midpoint of the line
        center = layer.getCenter(); // Leaflet method for polylines
    } else {
        // If it's neither a polygon nor a polyline, we can't label it this way
        return;
    }

    const labelMarker = L.marker(center, {
        icon: L.divIcon({
            className: 'airspace-label',
            html: `<div>${labelText}</div>`,
            iconSize: [200, 50], // Adjust size as needed
            iconAnchor: [100, 25] // Anchor in the center of the divIcon
        }),
        interactive: false // Ensure labels don't block clicks on underlying map features
    });

    // Add the label marker to the airspaceLayer group.
    // L.geoJSON already added the main feature, we add labels separately
    // but keep them in the same layerGroup for easy toggling.
    airspaceLayer.addLayer(labelMarker);
}

// --- Keep formatAltitude and getClassFromIcaoClass as they are ---
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

function getClassFromIcaoClass(icaoClass) {
    const classMap = {
        1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F', 7: 'G',
        8: 'Other', 9: 'CTR', 10: 'CTA', 11: 'TMA', 12: 'ATZ'
    };
    return classMap[icaoClass] || 'Unknown';
}

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

// --- Rest of your functions (initMap, parseCUPFile, addTurnpointsToMap, createSampleAirspace, etc.) ---
// Keep these as they are, with some minor adjustments if they were calling the old labeling functions.

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
    loadAirspace(); // Will now handle labels differently
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
    const airspaceGeoJson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": { "name": "London TMA (Sample)", "CLASS": 11, "lowerLimit": { "value": 2500, "unit": 1, "referenceDatum": 1 }, "upperLimit": { "value": 10000, "unit": 1, "referenceDatum": 1 } },
                "geometry": { "type": "Polygon", "coordinates": [[[-0.8, 51.3], [0.3, 51.3], [0.3, 51.7], [-0.8, 51.7], [-0.8, 51.3]]] }
            },
            {
                "type": "Feature",
                "properties": { "name": "Manchester CTA (Sample)", "CLASS": 10, "lowerLimit": { "value": 3000, "unit": 1, "referenceDatum": 1 }, "upperLimit": { "value": 7000, "unit": 1, "referenceDatum": 1 } },
                "geometry": { "type": "Polygon", "coordinates": [[[-2.6, 53.2], [-2.0, 53.2], [-2.0, 53.6], [-2.6, 53.6], [-2.6, 53.2]]] }
            },
            {
                "type": "Feature",
                "properties": { "name": "Birmingham ATZ (Sample)", "CLASS": 12, "lowerLimit": { "value": 0, "unit": 1, "referenceDatum": 0 }, "upperLimit": { "value": 2000, "unit": 1, "referenceDatum": 0 } },
                "geometry": { "type": "Polygon", "coordinates": [[[-1.8, 52.4], [-1.6, 52.4], [-1.6, 52.5], [-1.8, 52.5], [-1.8, 52.4]]] }
            },
            {
                "type": "Feature",
                "properties": { "name": "Scottish Airway (Sample)", "CLASS": 3, "lowerLimit": { "value": 5000, "unit": 1, "referenceDatum": 1 }, "upperLimit": { "value": 15000, "unit": 1, "referenceDatum": 1 } },
                "geometry": { "type": "LineString", "coordinates": [[-3.5, 55.8], [-3.1, 56.0], [-2.5, 56.5]] }
            }
        ]
    };


    // Clear existing airspace data from the layer group
    if (airspaceLayer) {
        airspaceLayer.clearLayers();
    } else {
        airspaceLayer = L.layerGroup();
    }

    const airspaceStyle = (feature) => {
        const airspaceClass = feature.properties.CLASS; // Using 'CLASS' for sample
        return {
            color: getAirspaceColor(airspaceClass),
            fillColor: getAirspaceColor(airspaceClass),
            fillOpacity: 0.1,
            weight: 1.5,
            opacity: 0.7,
            interactive: false
        };
    };

    const onEachAirspaceFeature = (feature, layer) => {
        let name = feature.properties.name || 'Unnamed Airspace';
        let altitudeText = '';
        if (feature.properties.lowerLimit && feature.properties.upperLimit) {
            const lowerAlt = formatAltitude(feature.properties.lowerLimit);
            const upperAlt = formatAltitude(feature.properties.upperLimit);
            altitudeText = `${lowerAlt} - ${upperAlt}`;
        } else if (feature.properties.AL_UNITS || feature.properties.AH_UNITS) {
            altitudeText = `${feature.properties.AL_UNITS || 'GND'} - ${feature.properties.AH_UNITS || 'UNL'}`;
        }
        
        const labelText = `${name}<br><small>${altitudeText}</small>`;

        if (layer instanceof L.Polygon || layer instanceof L.Polyline) {
            addAirspaceLabel(layer, labelText);
        }
    };

    const geoJsonLayer = L.geoJSON(airspaceGeoJson, {
        style: airspaceStyle,
        onEachFeature: onEachAirspaceFeature
    });

    airspaceLayer.addLayer(geoJsonLayer);

    if (airspaceVisible && map && !map.hasLayer(airspaceLayer)) {
        airspaceLayer.addTo(map);
    }
    
    console.log('Sample airspace created and loaded.');
}

// Toggle airspace visibility
function toggleAirspace() {
    if (!airspaceLayer) {
        console.warn('Airspace layer not initialized. Creating sample airspace.');
        createSampleAirspace(); // Ensure it's loaded if not already
        airspaceVisible = true; // Set to true since we just created it and will add it
        airspaceLayer.addTo(map);
        console.log('Sample airspace created and shown');
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
    // Use event.currentTarget instead of event.target for the click listener in HTML
    // if setScoringMethod is called directly from onclick.
    // For simplicity, let's just make sure it sets the correct one:
    const clickedOption = document.querySelector(`.scoring-option[onclick*="${method}"]`);
    if (clickedOption) {
        clickedOption.classList.add('active');
    }

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

window.onload = function() {
    initMap();
};
