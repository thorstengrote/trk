/**
 * Calculate the distance between two geographic points.
 * @param {Object} point1 - The first point with lat and lon properties.
 * @param {Object} point2 - The second point with lat and lon properties.
 * @returns {number} The distance in kilometers.
 */
function calculateDistance(point1, point2) {
    const R = 6371; // Earth's radius in km
    const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLon = (point2.lon - point1.lon) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * Calculate the time to travel between two points at a given speed.
 * @param {Object} point1 - The starting point.
 * @param {Object} point2 - The ending point.
 * @param {number} speed - The speed in km/s.
 * @returns {number} The time in milliseconds.
 */
function calculateTimeToNextPoint(point1, point2, speed) {
    const distance = calculateDistance(point1, point2);
    return (distance / speed) * 1000; // Convert to milliseconds
}

/**
 * Filter route coordinates by date range.
 * @param {Array} routeCoordinates - The array of route coordinates.
 * @param {string} startDate - The start date string.
 * @param {string} endDate - The end date string.
 * @returns {Array} The filtered route coordinates.
 */
function filterRouteByDateRange(routeCoordinates, startDate, endDate) {
    if (!startDate || !endDate) return routeCoordinates;
    const start = new Date(startDate);
    const end = new Date(endDate);
    return routeCoordinates.filter(point => {
        return point.time >= start && point.time <= end;
    });
}

/**
 * Generate a share link with the current date range and autoplay setting.
 * @param {string} startDate - The start date string.
 * @param {string} endDate - The end date string.
 * @returns {string} The generated share link.
 */
function generateShareLink(startDate, endDate) {
    if (!startDate || !endDate) {
        console.error('Please select both start and end dates.');
        return null;
    }
    const currentUrl = window.location.href.split('?')[0];
    return `${currentUrl}?start=${startDate}&end=${endDate}&autoplay=true`;
}

/**
 * Throttle API requests to comply with rate limits.
 * @param {number} maxRequestsPerSecond - The maximum number of requests allowed per second.
 * @returns {Promise} A promise that resolves when it's safe to make the next request.
 */
let lastRequestTime = 0;
async function throttleRequest(maxRequestsPerSecond) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    const timeToWait = Math.max(0, 1000 / maxRequestsPerSecond - timeSinceLastRequest);
    
    if (timeToWait > 0) {
        await new Promise(resolve => setTimeout(resolve, timeToWait));
    }
    
    lastRequestTime = Date.now();
}

/**
 * Format a date object to a string.
 * @param {Date} date - The date to format.
 * @returns {string} The formatted date string.
 */
function formatDate(date) {
    return date.toLocaleDateString();
}

/**
 * Format a time object to a string.
 * @param {Date} time - The time to format.
 * @returns {string} The formatted time string.
 */
function formatTime(time) {
    return time.toLocaleTimeString();
}

/**
 * Create a custom map icon.
 * @param {string} iconClass - The Font Awesome icon class.
 * @param {string} backgroundColor - The background color for the icon.
 * @returns {Object} A Leaflet divIcon object.
 */
function createCustomIcon(iconClass, backgroundColor) {
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color:${backgroundColor};color:white;width:30px;height:30px;display:flex;justify-content:center;align-items:center;border-radius:50%;"><i class="${iconClass}"></i></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
}

// Export functions for use in other modules
window.calculateDistance = calculateDistance;
window.calculateTimeToNextPoint = calculateTimeToNextPoint;
window.filterRouteByDateRange = filterRouteByDateRange;
window.generateShareLink = generateShareLink;
window.throttleRequest = throttleRequest;
window.formatDate = formatDate;
window.formatTime = formatTime;
window.createCustomIcon = createCustomIcon;
