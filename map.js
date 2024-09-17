// Constants
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
const OPENROUTE_URL = 'https://api.openrouteservice.org/v2/directions/driving-car';
const OPENROUTE_API_KEY = '5b3ce3597851110001cf6248c56af19b19b2427c9486702926df507d';
const MAX_REQUESTS_PER_SECOND = 1;
const HOME_COORDINATES = [50.7852, 7.0141]; // Coordinates for Altmühlstr., 53332 Bornheim, Germany
const MIN_DISTANCE = 0.1; // Minimum distance in kilometers for a real movement
const MIN_STOP_DURATION = 25; // Minimum stop duration in minutes for a POI

// Global variables
let map;
let routeCoordinates = [];
let markers = [];
let speed = 20; // km/s
let routePath;
let routeVisible = false;
let pointsVisible = false;
let animationRunning = false;
let currentAnimationIndex = 0;
let animationTimeout;
let driveRouteRunning = false;
let vanMarker;
let homeMarker;

// Initialization
function initializeApp() {
    console.log("Initializing app");
    document.getElementById('passwordOverlay').style.display = 'flex';
    
    const urlParams = new URLSearchParams(window.location.search);
    const startDate = urlParams.get('start');
    const endDate = urlParams.get('end');

    if (startDate) document.getElementById('startDate').value = startDate;
    if (endDate) document.getElementById('endDate').value = endDate;

    document.getElementById('speedRange').addEventListener('input', function() {
        updateSpeed(this.value);
    });
}

function checkPassword() {
    console.log("Checking password");
    const password = document.getElementById('passwordInput').value;
    if (password === 'thorsten') {
        document.getElementById('passwordOverlay').style.display = 'none';
        initializeMap();
        loadData();
    } else {
        alert('Incorrect password');
    }
}

function initializeMap() {
    console.log("Initializing map");
    map = L.map('map').setView(HOME_COORDINATES, 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    homeMarker = L.marker(HOME_COORDINATES, {
        icon: L.divIcon({
            className: 'custom-div-icon',
            html: '<div style="background-color:#FF5733;color:white;width:30px;height:30px;display:flex;justify-content:center;align-items:center;border-radius:50%;"><i class="fas fa-home"></i></div>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        })
    }).addTo(map);

    initializeElevationGraph();
}

// Data loading and processing
async function loadData() {
    console.log("Loading data");
    Papa.parse('https://docs.google.com/spreadsheets/d/13nN8lisfKRQHbD66J2pg1k5jN9lFz15ijwx0obu-03o/pub?gid=0&single=true&output=csv', {
        download: true,
        header: true,
        complete: async function(results) {
            let rawCoordinates = results.data
                .map(row => ({
                    lat: parseFloat(row.lat),
                    lon: parseFloat(row.lon),
                    time: new Date(row.time)
                }))
                .filter(point => !isNaN(point.lat) && !isNaN(point.lon) && !isNaN(point.time.getTime()))
                .sort((a, b) => a.time - b.time);

            console.log("Raw coordinates loaded:", rawCoordinates.length);

            routeCoordinates = processRouteData(rawCoordinates);
            console.log("Processed coordinates:", routeCoordinates.length);

            const elevationData = await fetchElevationData(routeCoordinates);
            routeCoordinates = routeCoordinates.map((point, index) => ({
                ...point,
                elevation: elevationData[index].elevation
            }));

            checkElevationData(routeCoordinates);
            updateDateRange();

            document.getElementById('speedRange').value = speed;
            document.getElementById('speedValue').textContent = speed;

            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('autoplay') === 'true') {
                startDriveRoute();
            }
        }
    });
}

function processRouteData(rawData) {
    console.log("Processing route data");
    let processedData = [];
    let currentPoint = null;
    let lastSignificantPoint = null;

    for (let i = 0; i < rawData.length; i++) {
        let point = rawData[i];
        
        if (!currentPoint) {
            currentPoint = { ...point, startTime: point.time, duration: 0 };
            lastSignificantPoint = currentPoint;
            processedData.push({ ...currentPoint, isPOI: true });
            continue;
        }

        let distance = calculateDistance(lastSignificantPoint, point);
        let timeDiff = (point.time - currentPoint.startTime) / (1000 * 60); // in minutes

        if (distance >= MIN_DISTANCE || timeDiff >= MIN_STOP_DURATION) {
            if (timeDiff >= MIN_STOP_DURATION) {
                processedData.push({ 
                    ...currentPoint, 
                    isPOI: true, 
                    startTime: currentPoint.startTime,
                    endTime: point.time,
                    time: point.time,
                    duration: timeDiff
                });
            } else {
                processedData.push({ ...currentPoint, isPOI: false });
            }
            lastSignificantPoint = point;
            currentPoint = { ...point, startTime: point.time, duration: 0 };
        } else {
            currentPoint.duration = timeDiff;
            currentPoint.time = point.time;
        }
    }

    // Add the last point
    if (currentPoint) {
        processedData.push({ 
            ...currentPoint, 
            isPOI: true,
            startTime: currentPoint.startTime,
            endTime: currentPoint.time,
            duration: (currentPoint.time - currentPoint.startTime) / (1000 * 60)
        });
    }

    console.log("Processed data:", processedData.length, "points");
    console.log("POI points:", processedData.filter(p => p.isPOI).length);
    return processedData;
}

// Map interaction functions
function updateDateRange() {
    console.log("Updating date range");
    let startDate = document.getElementById('startDate').value;
    let endDate = document.getElementById('endDate').value;
    routeCoordinates = filterRouteByDateRange(routeCoordinates, startDate, endDate);
    
    clearMap();

    if (pointsVisible) {
        showPoints();
    }

    if (routeVisible) {
        showRoute();
    }
}

function clearMap() {
    console.log("Clearing map");
    if (routePath) map.removeLayer(routePath);
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
}

function showPoints() {
    console.log("Showing points");
    clearMap();
    console.log("Number of points to show:", routeCoordinates.length);
    routeCoordinates.forEach(function(point, index) {
        let markerIcon = point.isPOI ? createPOIIcon(point) : L.divIcon({
            className: 'custom-div-icon',
            html: '<div style="background-color:#2196F3;width:10px;height:10px;border-radius:50%;"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        });
        var marker = L.marker([point.lat, point.lon], {icon: markerIcon}).addTo(map)
            .bindPopup(formatPopupContent(point));
        markers.push(marker);
        if (index === 0 || index === routeCoordinates.length - 1 || point.isPOI) {
            console.log("Significant point added:", point);
        }
    });
    console.log("Total markers added:", markers.length);
    if (routeCoordinates.length > 0) {
        map.fitBounds(L.latLngBounds(routeCoordinates.map(point => [point.lat, point.lon])));
    } else {
        console.log("No coordinates to show");
    }
}

function createPOIIcon(point) {
    let iconClass, backgroundColor;
    if (point.duration > 24 * 60) {
        [iconClass, backgroundColor] = ['fas fa-campground', '#4CAF50'];
    } else if (point.duration > 4 * 60) {
        [iconClass, backgroundColor] = ['fas fa-parking', '#3498db'];
    } else {
        [iconClass, backgroundColor] = ['fas fa-coffee', '#c30b82'];
    }
    return createCustomIcon(iconClass, backgroundColor);
}

function formatPopupContent(point) {
    const date = formatDate(point.time);
    const time = formatTime(point.time);
    const elevation = point.elevation !== undefined ? `${Math.round(point.elevation)}m` : 'N/A';
    let content = `Date: ${date}<br>Time: ${time}<br>Elevation: ${elevation}`;
    if (point.isPOI) {
        content += `<br>Stop Duration: ${Math.round(point.duration)} minutes`;
    }
    return content;
}

function togglePoints() {
    console.log("Toggling points");
    pointsVisible = !pointsVisible;
    if (pointsVisible) {
        showPoints();
    } else {
        clearMap();
    }
}

function toggleRoute() {
    console.log("Toggling route");
    routeVisible = !routeVisible;
    if (routeVisible) {
        showRoute();
    } else if (routePath) {
        map.removeLayer(routePath);
    }
}

function showRoute() {
    console.log("Showing route");
    if (routePath) map.removeLayer(routePath);
    calculateCompleteRoute();
}

// Animation and route functions
function toggleAnimation() {
    console.log("Toggling animation");
    if (animationRunning) {
        stopAnimation();
    } else {
        startAnimation();
    }
}

function startAnimation() {
    console.log("Starting animation");
    if (routePath) map.removeLayer(routePath);
    routePath = L.polyline([], {color: 'blue'}).addTo(map);
    animationRunning = true;
    currentAnimationIndex = 0;
    document.querySelector('button[onclick="toggleAnimation()"]').textContent = "Stop Animation";
    animateRoute(currentAnimationIndex);
}

function stopAnimation() {
    console.log("Stopping animation");
    animationRunning = false;
    clearTimeout(animationTimeout);
    document.querySelector('button[onclick="toggleAnimation()"]').textContent = "Start Animation";
}

function animateRoute(i) {
    if (i < routeCoordinates.length && animationRunning) {
        var point = routeCoordinates[i];
        var marker = L.marker([point.lat, point.lon]).addTo(map)
            .bindPopup(formatPopupContent(point))
            .openPopup();
        markers.push(marker);

        routePath.addLatLng([point.lat, point.lon]);
        map.setView([point.lat, point.lon]);

        updateElevationGraph(point.elevation);

        animationTimeout = setTimeout(function() {
            animateRoute(i + 1);
        }, 1000);
    } else if (i >= routeCoordinates.length) {
        stopAnimation();
    }
}

function toggleDriveRoute() {
    console.log("Toggling drive route");
    if (driveRouteRunning) {
        stopDriveRoute();
    } else {
        startDriveRoute();
    }
}

function startDriveRoute() {
    console.log("Starting drive route");
    document.getElementById('loadingModal').style.display = 'block';
    if (routePath) map.removeLayer(routePath);
    routePath = L.polyline([], {color: 'blue'}).addTo(map);
    driveRouteRunning = true;
    document.querySelector('button[onclick="toggleDriveRoute()"]').textContent = "Stop Driving";
    calculateCompleteRoute();
}

function stopDriveRoute() {
    console.log("Stopping drive route");
    driveRouteRunning = false;
    clearTimeout(animationTimeout);
    document.querySelector('button[onclick="toggleDriveRoute()"]').textContent = "Drive Route";
    if (vanMarker) map.removeLayer(vanMarker);
}

async function calculateCompleteRoute() {
    console.log("Calculating complete route");
    let completeRoute = [];
    let poiPoints = routeCoordinates.filter(point => point.isPOI);
    console.log("Number of POI points:", poiPoints.length);

    if (poiPoints.length === 0) {
        console.log("No POI points found, using all points");
        poiPoints = routeCoordinates;
    }

    try {
        if (poiPoints.length === 1) {
            completeRoute = [poiPoints[0]];
        } else {
            for (let i = 0; i < poiPoints.length - 1; i++) {
                let start = poiPoints[i];
                let end = poiPoints[i + 1];
                console.log(`Calculating route from ${start.lat},${start.lon} to ${end.lat},${end.lon}`);
                let route = await getRouteFromOSRM([start, end]);
                completeRoute = completeRoute.concat(route);
            }
        }

        console.log("Complete route calculated, points:", completeRoute.length);
        document.getElementById('loadingModal').style.display = 'none';
        if (completeRoute.length > 0) {
            routePath = L.polyline(completeRoute, {color: 'blue'}).addTo(map);
            map.fitBounds(L.latLngBounds(completeRoute));
            if (driveRouteRunning) {
                animateVanAlongRoute(completeRoute, 0);
            }
        } else {
            console.log("No route to display");
        }
    } catch (error) {
        console.error('Error calculating route:', error);
        alert('An error occurred while calculating the route. Please try again later.');
        document.getElementById('loadingModal').style.display = 'none';
        stopDriveRoute();
    }
}

function animateVanAlongRoute(route, step) {
    console.log("Animating van along route, step:", step);
    if (step < route.length && driveRouteRunning) {
        var point = route[step];
        var nextPoint = route[step + 1] || route[step];

        if (!vanMarker) {
            vanMarker = L.marker(point, {
                icon: L.divIcon({
                    className: 'van-icon',
                    iconSize: [30, 30],
                    iconAnchor: [15, 15],
                    html: '<div style="background-color:#4a4a4a;color:white;width:30px;height:30px;display:flex;justify-content:center;align-items:center;border-radius:50%;"><i class="fas fa-shuttle-van"></i></div>'
                })
            }).addTo(map);
        } else {
            vanMarker.setLatLng(point);
        }
        map.setView(point);

        const elevation = interpolateElevation(point, route, step);
        updateElevationGraph(elevation);

        currentAnimationIndex = step;
        var timeToNextPoint = calculateTimeToNextPoint(point, nextPoint, speed);
        animationTimeout = setTimeout(function() {
            animateVanAlongRoute(route, step + 1);
        }, timeToNextPoint);
    } else if (!driveRouteRunning) {
        stopDriveRoute();
    } else {
        console.log("Drive route animation complete");
        stopDriveRoute();
    }
}

// API-related functions
async function getRouteFromOSRM(points) {
    console.log("Getting route from OSRM");
    const cacheKey = `route_${points[0].lat},${points[0].lon}_${points[1].lat},${points[1].lon}`;
    const cachedRoute = await localforage.getItem(cacheKey);
    
    if (cachedRoute) {
        console.log("Using cached route");
        return cachedRoute;
    }

    await throttleRequest(MAX_REQUESTS_PER_SECOND);

    const coordinates = points.map(p => `${p.lon},${p.lat}`).join(';');
    const url = `${OSRM_URL}${coordinates}?overview=full&geometries=geojson&continue_straight=true`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('OSRM request failed');
        }
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
            await localforage.setItem(cacheKey, route);
            return route;
        }
    } catch (error) {
        console.error('Error fetching route from OSRM:', error);
        return getRouteFromOpenRoute(points);
    }
}

async function getRouteFromOpenRoute(points) {
    console.log("Getting route from OpenRoute");
    const cacheKey = `openroute_${points[0].lat},${points[0].lon}_${points[1].lat},${points[1].lon}`;
    const cachedRoute = await localforage.getItem(cacheKey);
    
    if (cachedRoute) {
        console.log("Using cached route");
        return cachedRoute;
    }

    await throttleRequest(MAX_REQUESTS_PER_SECOND);

    const body = {
        coordinates: points.map(p => [p.lon, p.lat])
    };

    try {
        const response = await fetch(OPENROUTE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': OPENROUTE_API_KEY
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error('OpenRoute request failed');
        }

        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
            await localforage.setItem(cacheKey, route);
            return route;
        }
    } catch (error) {
        console.error('Error fetching route from OpenRoute:', error);
        throw error;
    }
}

// Utility functions
function updateSpeed(value) {
    console.log("Updating speed to:", value);
    document.getElementById('speedValue').textContent = value;
    speed = parseInt(value);
}

function toggleControls() {
    console.log("Toggling controls");
    const controlsContent = document.getElementById('controls-content');
    controlsContent.classList.toggle('expanded');
}

// Elevation-related functions
async function fetchElevationData(coordinates) {
    console.log("Fetching elevation data");
    const BATCH_SIZE = 100; // Adjust based on API limitations
    let allResults = [];

    for (let i = 0; i < coordinates.length; i += BATCH_SIZE) {
        const batch = coordinates.slice(i, i + BATCH_SIZE);
        const url = 'https://api.open-elevation.com/api/v1/lookup';
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                locations: batch.map(coord => ({ latitude: coord.lat, longitude: coord.lon }))
            }),
        });
        const data = await response.json();
        allResults = allResults.concat(data.results);
    }

    console.log("Elevation data fetched for", allResults.length, "points");
    return allResults;
}

// Share link generation
function generateShareLink() {
    console.log("Generating share link");
    var startDate = document.getElementById('startDate').value;
    var endDate = document.getElementById('endDate').value;
    if (!startDate || !endDate) {
        alert('Please select both start and end dates.');
        return;
    }
    var currentUrl = window.location.href.split('?')[0]; // Remove existing query parameters
    var shareUrl = `${currentUrl}?start=${startDate}&end=${endDate}&autoplay=true`;
    var shareLinkElement = document.getElementById('shareLink');
    shareLinkElement.innerHTML = `<a href="${shareUrl}" target="_blank">${shareUrl}</a>`;
    console.log("Share link generated:", shareUrl);
}

// Export functions for use in HTML and other modules
window.checkPassword = checkPassword;
window.toggleControls = toggleControls;
window.updateSpeed = updateSpeed;
window.togglePoints = togglePoints;
window.toggleAnimation = toggleAnimation;
window.toggleRoute = toggleRoute;
window.toggleDriveRoute = toggleDriveRoute;
window.updateDateRange = updateDateRange;
window.generateShareLink = generateShareLink;

// Initialize the application
initializeApp();

// Debug logging
console.log("map.js loaded");
console.log("Available functions:");
console.log("checkPassword:", typeof window.checkPassword);
console.log("toggleControls:", typeof window.toggleControls);
console.log("updateSpeed:", typeof window.updateSpeed);
console.log("togglePoints:", typeof window.togglePoints);
console.log("toggleAnimation:", typeof window.toggleAnimation);
console.log("toggleRoute:", typeof window.toggleRoute);
console.log("toggleDriveRoute:", typeof window.toggleDriveRoute);
console.log("updateDateRange:", typeof window.updateDateRange);
console.log("generateShareLink:", typeof window.generateShareLink);
