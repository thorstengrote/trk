// Global variables
let map, routeCoordinates = [], markers = [], speed = 20, routePath, routeVisible = false, 
    pointsVisible = false, animationRunning = false, currentAnimationIndex = 0, 
    animationTimeout, driveRouteRunning = false, vanMarker, homeMarker, stopPoints = [];

// Constants
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
const OPENROUTE_URL = 'https://api.openrouteservice.org/v2/directions/driving-car';
const OPENROUTE_API_KEY = '5b3ce3597851110001cf6248c56af19b19b2427c9486702926df507d';
const MAX_REQUESTS_PER_SECOND = 1;
const HOME_COORDINATES = [50.7852, 7.0141];
const MAX_DISTANCE = 0.3; // km

function initializeMap() {
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

function loadData() {
    console.log("Loading data");
    Papa.parse('https://docs.google.com/spreadsheets/d/13nN8lisfKRQHbD66J2pg1k5jN9lFz15ijwx0obu-03o/pub?gid=0&single=true&output=csv', {
        download: true,
        header: true,
        complete: function(results) {
            let rawCoordinates = results.data
                .map(row => ({
                    lat: parseFloat(row.lat),
                    lon: parseFloat(row.lon),
                    time: new Date(row.time),
                    elevation: row.elevation !== "N/A" ? parseFloat(row.elevation) : null
                }))
                .filter(point => !isNaN(point.lat) && !isNaN(point.lon) && !isNaN(point.time.getTime()))
                .sort((a, b) => a.time - b.time);

            console.log("Raw coordinates loaded:", rawCoordinates.length);

            routeCoordinates = processRouteData(rawCoordinates);
            console.log("Processed coordinates:", routeCoordinates.length);

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
    let virtualWaypoints = consolidateWaypoints(rawData);
    
    let processedData = virtualWaypoints.map(point => {
        let poiType = 'waypoint';
        if (point.duration >= 25 && point.duration < 240) {
            poiType = 'coffee';
        } else if (point.duration >= 240 && point.duration < 1440) {
            poiType = 'parking';
        } else if (point.duration >= 1440) {
            poiType = 'campground';
        }
        return { ...point, poiType };
    });

    console.log("Processed data:", processedData.length, "points");
    console.log("POI points:", processedData.filter(p => p.poiType !== 'waypoint').length);
    return processedData;
}

function consolidateWaypoints(rawData) {
    let virtualWaypoints = [];
    let currentGroup = [];

    for (let i = 0; i < rawData.length; i++) {
        if (currentGroup.length === 0) {
            currentGroup.push(rawData[i]);
        } else {
            const lastPoint = currentGroup[currentGroup.length - 1];
            const distance = calculateDistance(lastPoint, rawData[i]);
            
            if (distance <= MAX_DISTANCE) {
                currentGroup.push(rawData[i]);
            } else {
                virtualWaypoints.push(createVirtualWaypoint(currentGroup));
                currentGroup = [rawData[i]];
            }
        }
    }

    if (currentGroup.length > 0) {
        virtualWaypoints.push(createVirtualWaypoint(currentGroup));
    }

    return virtualWaypoints;
}

function createVirtualWaypoint(group) {
    const firstPoint = group[0];
    const lastPoint = group[group.length - 1];
    const duration = (lastPoint.time - firstPoint.time) / (1000 * 60); // in minutes

    return {
        lat: firstPoint.lat,
        lon: firstPoint.lon,
        time: firstPoint.time,
        duration: duration,
        elevation: firstPoint.elevation
    };
}

function showPoints() {
    console.log("Showing points");
    clearMap();
    console.log("Number of points to show:", routeCoordinates.length);
    routeCoordinates.forEach(function(point, index) {
        let markerIcon;
        switch (point.poiType) {
            case 'coffee':
                markerIcon = createCustomIcon('fas fa-coffee', '#c30b82');
                break;
            case 'parking':
                markerIcon = createCustomIcon('fas fa-parking', '#3498db');
                break;
            case 'campground':
                markerIcon = createCustomIcon('fas fa-campground', '#4CAF50');
                break;
            default:
                markerIcon = L.divIcon({
                    className: 'custom-div-icon',
                    html: '<div style="background-color:#2196F3;width:10px;height:10px;border-radius:50%;"></div>',
                    iconSize: [10, 10],
                    iconAnchor: [5, 5]
                });
        }
        var marker = L.marker([point.lat, point.lon], {icon: markerIcon}).addTo(map)
            .bindPopup(formatPopupContent(point));
        markers.push(marker);
        if (point.poiType !== 'waypoint') {
            console.log("POI added:", point);
        }
    });
    console.log("Total markers added:", markers.length);
    if (routeCoordinates.length > 0) {
        map.fitBounds(L.latLngBounds(routeCoordinates.map(point => [point.lat, point.lon])));
    } else {
        console.log("No coordinates to show");
    }
}

function togglePoints() {
    pointsVisible = !pointsVisible;
    if (pointsVisible) {
        showPoints();
    } else {
        clearMap();
    }
}

function toggleAnimation() {
    if (animationRunning) {
        stopAnimation();
    } else {
        startAnimation();
    }
}

function toggleRoute() {
    routeVisible = !routeVisible;
    if (routeVisible) {
        showRoute();
    } else if (routePath) {
        map.removeLayer(routePath);
    }
}

function toggleDriveRoute() {
    if (driveRouteRunning) {
        stopDriveRoute();
    } else {
        startDriveRoute();
    }
}

function startAnimation() {
    if (routePath) map.removeLayer(routePath);
    routePath = L.polyline([], {color: 'blue'}).addTo(map);
    animationRunning = true;
    currentAnimationIndex = 0;
    document.querySelector('button[onclick="toggleAnimation()"]').textContent = "Stop Animation";
    animateRoute(currentAnimationIndex);
}

function stopAnimation() {
    animationRunning = false;
    clearTimeout(animationTimeout);
    document.querySelector('button[onclick="toggleAnimation()"]').textContent = "Start Animation";
}

function startDriveRoute() {
    console.log("Starting drive route");
    document.getElementById('loadingModal').style.display = 'block';
    clearMap();
    routePath = null;
    vanMarker = null;
    driveRouteRunning = true;
    document.querySelector('button[onclick="toggleDriveRoute()"]').textContent = "Stop Driving";
    calculateCompleteRoute();
}

function stopDriveRoute() {
    driveRouteRunning = false;
    clearTimeout(animationTimeout);
    document.querySelector('button[onclick="toggleDriveRoute()"]').textContent = "Drive Route";
    if (vanMarker) map.removeLayer(vanMarker);
}

function updateSpeed(value) {
    console.log("Updating speed to:", value);
    document.getElementById('speedValue').textContent = value;
    speed = parseInt(value);
}

function updateDateRange() {
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

function generateShareLink() {
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
}

function clearMap() {
    if (routePath) map.removeLayer(routePath);
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
}

function createCustomIcon(iconClass, backgroundColor) {
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color:${backgroundColor};color:white;width:30px;height:30px;display:flex;justify-content:center;align-items:center;border-radius:50%;"><i class="${iconClass}"></i></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
}

function formatPopupContent(point) {
    const date = formatDate(point.time);
    const time = formatTime(point.time);
    const elevation = point.elevation !== null ? `${Math.round(point.elevation)}m` : 'N/A';
    let content = `Date: ${date}<br>Time: ${time}<br>Elevation: ${elevation}`;
    if (point.poiType !== 'waypoint') {
        content += `<br>Stop Duration: ${Math.round(point.duration)} minutes`;
        content += `<br>Type: ${point.poiType.charAt(0).toUpperCase() + point.poiType.slice(1)}`;
    }
    return content;
}

async function calculateCompleteRoute() {
    console.log("Calculating complete route");
    let completeRoute = [];
    let poiPoints = routeCoordinates.filter(point => point.poiType !== 'waypoint');
    console.log("Number of POI points:", poiPoints.length);

    try {
        for (let i = 0; i < poiPoints.length - 1; i++) {
            let start = poiPoints[i];
            let end = poiPoints[i + 1];
            console.log(`Calculating route from ${start.lat},${start.lon} to ${end.lat},${end.lon}`);
            let route = await getRouteFromOSRM([start, end]);
            completeRoute = completeRoute.concat(route);
        }

        console.log("Complete route calculated, points:", completeRoute.length);
        document.getElementById('loadingModal').style.display = 'none';
        if (completeRoute.length > 0) {
            animateVanAlongRoute(completeRoute, 0);
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

        if (!routePath) {
            routePath = L.polyline([point], {color: 'blue'}).addTo(map);
        } else {
            routePath.addLatLng(point);
        }

        map.setView(point);

        // Check if this point is a POI and add marker if so
        let poiPoint = routeCoordinates.find(p => p.poiType !== 'waypoint' && Math.abs(p.lat - point[0]) < 0.0001 && Math.abs(p.lon - point[1]) < 0.0001);
        if (poiPoint) {
            addPOIMarker(poiPoint);
        }

        updateElevationGraph(interpolateElevation(point, route, step));

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

function addPOIMarker(point) {
    let markerIcon = createCustomIcon(getPOIIconClass(point.poiType), getPOIColor(point.poiType));
    L.marker([point.lat, point.lon], {icon: markerIcon})
        .addTo(map)
        .bindPopup(formatPopupContent(point));
}

function getPOIIconClass(poiType) {
    switch (poiType) {
        case 'coffee': return 'fas fa-coffee';
        case 'parking': return 'fas fa-parking';
        case 'campground': return 'fas fa-campground';
        default: return 'fas fa-map-marker';
    }
}

function getPOIColor(poiType) {
    switch (poiType) {
        case 'coffee': return '#c30b82';
        case 'parking': return '#3498db';
        case 'campground': return '#4CAF50';
        default: return '#2196F3';
    }
}

function interpolateElevation(point, route, step) {
    const prevWaypoint = findPreviousWaypoint(route, step);
    const nextWaypoint = findNextWaypoint(route, step);

    if (!prevWaypoint && !nextWaypoint) {
        console.log("No elevation data available for interpolation");
        return null;
    }

    if (!prevWaypoint) return nextWaypoint.elevation;
    if (!nextWaypoint) return prevWaypoint.elevation;

    if (prevWaypoint.elevation === null || nextWaypoint.elevation === null) {
        return prevWaypoint.elevation !== null ? prevWaypoint.elevation : nextWaypoint.elevation;
    }

    const totalDistance = calculateDistance(prevWaypoint, nextWaypoint);
    const distanceToPoint = calculateDistance(prevWaypoint, point);
    const ratio = distanceToPoint / totalDistance;

    const interpolatedElevation = prevWaypoint.elevation + (nextWaypoint.elevation - prevWaypoint.elevation) * ratio;
    console.log("Interpolated elevation:", interpolatedElevation);
    return interpolatedElevation;
}

function findPreviousWaypoint(route, step) {
    for (let i = step; i >= 0; i--) {
        if (route[i].elevation !== null) {
            return route[i];
        }
    }
    return null;
}

function findNextWaypoint(route, step) {
    for (let i = step; i < route.length; i++) {
        if (route[i].elevation !== null) {
            return route[i];
        }
    }
    return null;
}

function checkPassword() {
    const password = document.getElementById('passwordInput').value;
    if (password === 'thorsten') {
        document.getElementById('passwordOverlay').style.display = 'none';
        initializeMap();
        loadData();
    } else {
        alert('Incorrect password');
    }
}

function filterRouteByDateRange(coordinates, startDate, endDate) {
    if (!startDate || !endDate) return coordinates;
    const start = new Date(startDate);
    const end = new Date(endDate);
    return coordinates.filter(point => point.time >= start && point.time <= end);
}

function toggleControls() {
    const controlsContent = document.getElementById('controls-content');
    controlsContent.classList.toggle('expanded');
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('passwordOverlay').style.display = 'flex';
    
    const urlParams = new URLSearchParams(window.location.search);
    const startDate = urlParams.get('start');
    const endDate = urlParams.get('end');

    if (startDate) document.getElementById('startDate').value = startDate;
    if (endDate) document.getElementById('endDate').value = endDate;

    // Add other necessary event listeners here
    document.getElementById('speedRange').addEventListener('input', function() {
        updateSpeed(this.value);
    });
});

// Export functions to global scope
window.checkPassword = checkPassword;
window.toggleControls = toggleControls;
window.updateSpeed = updateSpeed;
window.togglePoints = togglePoints;
window.toggleAnimation = toggleAnimation;
window.toggleRoute = toggleRoute;
window.toggleDriveRoute = toggleDriveRoute;
window.updateDateRange = updateDateRange;
window.generateShareLink = generateShareLink;
window.startAnimation = startAnimation;
window.stopAnimation = stopAnimation;

// Initialize the application
initializeMap();
loadData();

console.log("map.js loaded");
