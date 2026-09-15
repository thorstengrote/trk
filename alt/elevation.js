// Elevation graph constants
const GRAPH_WIDTH = 200;
const GRAPH_HEIGHT = 100;

// Elevation graph variables
let elevationGraphCtx;
let elevationData = [];

/**
 * Initialize the elevation graph.
 */
function initializeElevationGraph() {
    const canvas = document.getElementById('elevationGraph');
    canvas.width = GRAPH_WIDTH;
    canvas.height = GRAPH_HEIGHT;
    elevationGraphCtx = canvas.getContext('2d');
}

/**
 * Update the elevation graph with new elevation data.
 * @param {number} currentElevation - The current elevation value.
 */
function updateElevationGraph(currentElevation) {
    console.log("Updating elevation graph with:", currentElevation);

    if (isNaN(currentElevation)) {
        console.log("Invalid elevation data, skipping graph update");
        return;
    }

    elevationData.push(currentElevation);
    if (elevationData.length > GRAPH_WIDTH) {
        elevationData.shift();
    }

    drawElevationGraph();
}

/**
 * Draw the elevation graph.
 */
function drawElevationGraph() {
    elevationGraphCtx.clearRect(0, 0, GRAPH_WIDTH, GRAPH_HEIGHT);

    // Draw background
    elevationGraphCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    elevationGraphCtx.fillRect(0, 0, GRAPH_WIDTH, GRAPH_HEIGHT);

    // Draw elevation line
    elevationGraphCtx.beginPath();
    elevationGraphCtx.moveTo(0, GRAPH_HEIGHT);

    const maxElevation = Math.max(...elevationData, 3000);
    const minElevation = Math.min(...elevationData, 0);

    console.log("Elevation data range:", minElevation, "-", maxElevation);

    for (let i = 0; i < elevationData.length; i++) {
        const x = i;
        const y = GRAPH_HEIGHT - ((elevationData[i] - minElevation) / (maxElevation - minElevation)) * GRAPH_HEIGHT;
        elevationGraphCtx.lineTo(x, y);
    }

    elevationGraphCtx.strokeStyle = 'blue';
    elevationGraphCtx.stroke();

    // Draw Y-axis labels
    elevationGraphCtx.fillStyle = 'black';
    elevationGraphCtx.font = '10px Arial';
    elevationGraphCtx.fillText(`${Math.round(maxElevation)}m`, 5, 15);
    elevationGraphCtx.fillText(`${Math.round(minElevation)}m`, 5, GRAPH_HEIGHT - 5);

    // Draw current elevation
    const currentElevation = elevationData[elevationData.length - 1];
    elevationGraphCtx.fillStyle = 'red';
    elevationGraphCtx.fillText(`Current: ${Math.round(currentElevation)}m`, GRAPH_WIDTH - 80, 15);
}

/**
 * Interpolate elevation for a given point between two waypoints.
 * @param {Object} point - The current point.
 * @param {Array} route - The route array containing elevation data.
 * @param {number} step - The current step in the route.
 * @returns {number} The interpolated elevation.
 */
function interpolateElevation(point, route, step) {
    const prevWaypoint = findPreviousWaypoint(route, step);
    const nextWaypoint = findNextWaypoint(route, step);

    if (!prevWaypoint && !nextWaypoint) {
        console.log("No elevation data available for interpolation");
        return 0;
    }

    if (!prevWaypoint) {
        console.log("Using next waypoint elevation:", nextWaypoint.elevation);
        return nextWaypoint.elevation;
    }
    if (!nextWaypoint) {
        console.log("Using previous waypoint elevation:", prevWaypoint.elevation);
        return prevWaypoint.elevation;
    }

    const totalDistance = calculateDistance(prevWaypoint, nextWaypoint);
    const distanceToPoint = calculateDistance(prevWaypoint, point);
    const ratio = distanceToPoint / totalDistance;

    const interpolatedElevation = prevWaypoint.elevation + (nextWaypoint.elevation - prevWaypoint.elevation) * ratio;
    console.log("Interpolated elevation:", interpolatedElevation);
    return interpolatedElevation;
}

/**
 * Find the previous waypoint with elevation data.
 * @param {Array} route - The route array containing elevation data.
 * @param {number} step - The current step in the route.
 * @returns {Object|null} The previous waypoint or null if not found.
 */
function findPreviousWaypoint(route, step) {
    for (let i = step; i >= 0; i--) {
        if (route[i].elevation !== undefined) {
            return route[i];
        }
    }
    return null;
}

/**
 * Find the next waypoint with elevation data.
 * @param {Array} route - The route array containing elevation data.
 * @param {number} step - The current step in the route.
 * @returns {Object|null} The next waypoint or null if not found.
 */
function findNextWaypoint(route, step) {
    for (let i = step; i < route.length; i++) {
        if (route[i].elevation !== undefined) {
            return route[i];
        }
    }
    return null;
}

/**
 * Check and log elevation data statistics.
 * @param {Array} routeCoordinates - The array of route coordinates.
 */
function checkElevationData(routeCoordinates) {
    console.log("Checking elevation data:");
    let validElevations = routeCoordinates.filter(point => point.elevation !== undefined && !isNaN(point.elevation));
    console.log(`Total points: ${routeCoordinates.length}`);
    console.log(`Points with valid elevation: ${validElevations.length}`);
    if (validElevations.length > 0) {
        let minElevation = Math.min(...validElevations.map(p => p.elevation));
        let maxElevation = Math.max(...validElevations.map(p => p.elevation));
        console.log(`Elevation range: ${minElevation}m - ${maxElevation}m`);
    } else {
        console.log("No valid elevation data found!");
    }
}

/**
 * Test the elevation graph with sample data.
 */
function testElevationGraph() {
    console.log("Testing elevation graph");
    const testData = [0, 100, 200, 150, 300, 250, 400, 350, 500, 450];
    testData.forEach(elevation => {
        updateElevationGraph(elevation);
    });
}

// Export functions for use in other modules
window.initializeElevationGraph = initializeElevationGraph;
window.updateElevationGraph = updateElevationGraph;
window.interpolateElevation = interpolateElevation;
window.checkElevationData = checkElevationData;
window.testElevationGraph = testElevationGraph;
