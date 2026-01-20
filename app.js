/**
 * Route Optimizer - Main Application
 * A PWA for optimizing multi-stop routes
 */

// ===================================
// State Management
// ===================================

const state = {
    startLocation: null,
    destinations: [],
    returnToStart: true,
    departureTime: null,
    map: null,
    routeLayer: null,
    markersLayer: null,
    isOptimizing: false
};

// Destination counter for unique IDs
let destinationCounter = 0;

// ===================================
// DOM Elements
// ===================================

const elements = {
    startLocationInput: document.getElementById('startLocation'),
    startSuggestions: document.getElementById('startSuggestions'),
    startLocationStatus: document.getElementById('startLocationStatus'),
    detectLocationBtn: document.getElementById('detectLocationBtn'),
    addDestinationBtn: document.getElementById('addDestinationBtn'),
    destinationsList: document.getElementById('destinationsList'),
    returnToStartCheckbox: document.getElementById('returnToStart'),
    useDepartureTimeCheckbox: document.getElementById('useDepartureTime'),
    departureTimeContainer: document.getElementById('departureTimeContainer'),
    departureTimeInput: document.getElementById('departureTime'),
    optimizeBtn: document.getElementById('optimizeBtn'),
    resultsSection: document.getElementById('resultsSection'),
    optimizedTime: document.getElementById('optimizedTime'),
    timeSaved: document.getElementById('timeSaved'),
    totalDistance: document.getElementById('totalDistance'),
    optimizedOrderList: document.getElementById('optimizedOrderList'),
    openInMapsBtn: document.getElementById('openInMapsBtn'),
    toast: document.getElementById('toast')
};

// ===================================
// Initialization
// ===================================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    // Add event listeners
    elements.detectLocationBtn.addEventListener('click', detectUserLocation);
    elements.addDestinationBtn.addEventListener('click', addDestination);
    elements.returnToStartCheckbox.addEventListener('change', handleReturnToStartChange);
    elements.useDepartureTimeCheckbox.addEventListener('change', handleDepartureTimeToggle);
    elements.departureTimeInput.addEventListener('change', handleDepartureTimeChange);
    elements.optimizeBtn.addEventListener('click', optimizeRoute);
    elements.openInMapsBtn.addEventListener('click', openInGoogleMaps);
    
    // Set default departure time to now + 15 minutes
    const now = new Date();
    now.setMinutes(now.getMinutes() + 15);
    elements.departureTimeInput.value = now.toISOString().slice(0, 16);
    
    // Start location input with autocomplete
    setupAutocomplete(elements.startLocationInput, elements.startSuggestions, (location) => {
        state.startLocation = location;
        updateOptimizeButton();
        showToast('Start location set', 'success');
    });
    
    // Add initial destination field
    addDestination();
    
    // Try to auto-detect location on load
    detectUserLocation();
}

// ===================================
// Geolocation
// ===================================

function detectUserLocation() {
    if (!navigator.geolocation) {
        showToast('Geolocation not supported', 'error');
        return;
    }
    
    elements.startLocationStatus.textContent = 'Detecting location...';
    elements.startLocationStatus.className = 'location-status';
    elements.detectLocationBtn.disabled = true;
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude } = position.coords;
            
            try {
                // Reverse geocode to get address
                const address = await reverseGeocode(latitude, longitude);
                
                state.startLocation = {
                    address: address,
                    lat: latitude,
                    lng: longitude
                };
                
                elements.startLocationInput.value = address;
                elements.startLocationStatus.textContent = '✓ Location detected';
                elements.startLocationStatus.className = 'location-status success';
                updateOptimizeButton();
            } catch (error) {
                elements.startLocationStatus.textContent = 'Could not get address. Please enter manually.';
                elements.startLocationStatus.className = 'location-status error';
            }
            
            elements.detectLocationBtn.disabled = false;
        },
        (error) => {
            let message = 'Could not detect location';
            if (error.code === error.PERMISSION_DENIED) {
                message = 'Location permission denied. Please enter manually.';
            }
            elements.startLocationStatus.textContent = message;
            elements.startLocationStatus.className = 'location-status error';
            elements.detectLocationBtn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// ===================================
// Geocoding (using OpenStreetMap Nominatim)
// ===================================

async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
        );
        if (!response.ok) {
            throw new Error('Geocoding request failed');
        }
        const data = await response.json();
        return data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (error) {
        console.error('Reverse geocoding error:', error);
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}

async function geocode(query) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`
        );
        if (!response.ok) {
            throw new Error('Geocoding request failed');
        }
        return await response.json();
    } catch (error) {
        console.error('Geocoding error:', error);
        return [];
    }
}

async function searchLocation(query, nearLat = null, nearLng = null) {
    try {
        let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10`;
        
        // If we have a reference point, use bounded search to prefer nearby results
        if (nearLat && nearLng) {
            const viewbox = `${nearLng - 0.5},${nearLat - 0.5},${nearLng + 0.5},${nearLat + 0.5}`;
            url += `&viewbox=${viewbox}&bounded=0`;
        }
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Location search request failed');
        }
        const results = await response.json();
        
        // If we have a reference point, sort results by straight-line distance first
        // (will be refined with driving time later)
        if (nearLat && nearLng && results.length > 0) {
            results.forEach(result => {
                result.straightLineDistance = calculateDistance(
                    nearLat, nearLng,
                    parseFloat(result.lat), parseFloat(result.lon)
                );
            });
            results.sort((a, b) => a.straightLineDistance - b.straightLineDistance);
        }
        
        return results;
    } catch (error) {
        console.error('Location search error:', error);
        return [];
    }
}

// Estimate driving time to a location from a reference point
async function estimateDrivingTime(fromLat, fromLng, toLat, toLng) {
    const coords = `${fromLng.toFixed(6)},${fromLat.toFixed(6)};${toLng.toFixed(6)},${toLat.toFixed(6)}`;
    
    // Try each routing server
    for (const serverUrl of ROUTING_SERVERS) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(
                `${serverUrl}/route/v1/driving/${coords}?overview=false`,
                { signal: controller.signal }
            );
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                continue; // Try next server
            }
            
            const data = await response.json();
            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                return {
                    duration: data.routes[0].duration, // seconds
                    distance: data.routes[0].distance  // meters
                };
            }
        } catch (error) {
            console.warn(`Driving time estimation failed for ${serverUrl}:`, error.message);
            // Continue to next server
        }
    }
    
    // Fallback: estimate using straight-line distance
    const straightLineKm = calculateDistance(fromLat, fromLng, toLat, toLng);
    // Assume average speed of 40 km/h for urban driving
    return {
        duration: (straightLineKm / 40) * 3600, // seconds
        distance: straightLineKm * 1000, // meters
        isEstimate: true
    };
}

// Search for locations with driving time estimates
async function searchLocationWithTimes(query, nearLat, nearLng) {
    const results = await searchLocation(query, nearLat, nearLng);
    
    if (!nearLat || !nearLng || results.length === 0) {
        return results;
    }
    
    // Get driving times for top results (limit to 3 to avoid overwhelming the API)
    const topResults = results.slice(0, 3);
    
    // Process sequentially with a small delay to avoid rate limiting
    const resultsWithTimes = [];
    for (let i = 0; i < topResults.length; i++) {
        const result = topResults[i];
        const timeInfo = await estimateDrivingTime(
            nearLat, nearLng,
            parseFloat(result.lat), parseFloat(result.lon)
        );
        resultsWithTimes.push({
            ...result,
            drivingTime: timeInfo ? timeInfo.duration : null,
            drivingDistance: timeInfo ? timeInfo.distance : null
        });
        
        // Add small delay between requests to be respectful to the API
        if (i < topResults.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    // Sort by driving time (fallback to straight-line distance if time unavailable)
    resultsWithTimes.sort((a, b) => {
        if (a.drivingTime !== null && b.drivingTime !== null) {
            return a.drivingTime - b.drivingTime;
        }
        if (a.drivingTime !== null) return -1;
        if (b.drivingTime !== null) return 1;
        return (a.straightLineDistance || 0) - (b.straightLineDistance || 0);
    });
    
    return resultsWithTimes;
}

// ===================================
// Autocomplete
// ===================================

let autocompleteTimeout = null;

function setupAutocomplete(inputElement, suggestionsElement, onSelect, useTimesEstimate = false) {
    inputElement.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        // Clear previous timeout
        if (autocompleteTimeout) {
            clearTimeout(autocompleteTimeout);
        }
        
        if (query.length < 3) {
            hideSuggestions(suggestionsElement);
            return;
        }
        
        // Debounce API calls
        autocompleteTimeout = setTimeout(async () => {
            try {
                let results;
                // For destination inputs, use time-based search if we have a start location
                if (useTimesEstimate && state.startLocation) {
                    results = await searchLocationWithTimes(
                        query,
                        state.startLocation.lat,
                        state.startLocation.lng
                    );
                } else {
                    results = await geocode(query);
                }
                
                showSuggestions(suggestionsElement, results, (result) => {
                    inputElement.value = result.display_name;
                    onSelect({
                        address: result.display_name,
                        lat: parseFloat(result.lat),
                        lng: parseFloat(result.lon)
                    });
                    hideSuggestions(suggestionsElement);
                }, useTimesEstimate);
            } catch (error) {
                console.error('Autocomplete error:', error);
            }
        }, 300);
    });
    
    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!inputElement.contains(e.target) && !suggestionsElement.contains(e.target)) {
            hideSuggestions(suggestionsElement);
        }
    });
}

function showSuggestions(container, results, onSelect, showTimes = false) {
    container.innerHTML = '';
    
    if (results.length === 0) {
        container.innerHTML = '<div class="suggestion-item">No results found</div>';
        container.classList.add('active');
        return;
    }
    
    results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        
        // Create suggestion content with optional time badge
        const nameSpan = document.createElement('span');
        nameSpan.className = 'suggestion-name';
        nameSpan.textContent = result.display_name;
        item.appendChild(nameSpan);
        
        // Add driving time badge if available
        if (showTimes && result.drivingTime !== null && result.drivingTime !== undefined) {
            const timeBadge = document.createElement('span');
            timeBadge.className = 'suggestion-time-badge';
            const minutes = Math.round(result.drivingTime / 60);
            if (minutes < 60) {
                timeBadge.textContent = `+${minutes} min`;
            } else {
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                timeBadge.textContent = `+${hours}h ${mins}m`;
            }
            item.appendChild(timeBadge);
        }
        
        item.addEventListener('click', () => onSelect(result));
        container.appendChild(item);
    });
    
    container.classList.add('active');
}

function hideSuggestions(container) {
    container.classList.remove('active');
}

// ===================================
// Destination Management
// ===================================

function addDestination() {
    const id = ++destinationCounter;
    
    const destination = {
        id: id,
        address: '',
        location: null,
        locked: false
    };
    
    state.destinations.push(destination);
    renderDestinations();
    updateOptimizeButton();
    
    // Focus the new input
    setTimeout(() => {
        const newInput = document.querySelector(`[data-destination-id="${id}"] .destination-input`);
        if (newInput) newInput.focus();
    }, 100);
}

function removeDestination(id) {
    state.destinations = state.destinations.filter(d => d.id !== id);
    renderDestinations();
    updateOptimizeButton();
}

function toggleDestinationLock(id) {
    const destination = state.destinations.find(d => d.id === id);
    if (destination) {
        destination.locked = !destination.locked;
        renderDestinations();
        showToast(destination.locked ? 'Destination locked' : 'Destination unlocked', 'success');
    }
}

function renderDestinations() {
    elements.destinationsList.innerHTML = '';
    
    if (state.destinations.length === 0) {
        elements.destinationsList.innerHTML = `
            <div class="empty-state">
                <div class="icon">📍</div>
                <p>Click "+ Add" to add destinations</p>
            </div>
        `;
        return;
    }
    
    state.destinations.forEach((dest, index) => {
        const item = createDestinationElement(dest, index + 1);
        elements.destinationsList.appendChild(item);
    });
    
    // Initialize drag and drop
    initializeDragAndDrop();
}

function createDestinationElement(destination, number) {
    const item = document.createElement('div');
    item.className = 'destination-item';
    item.dataset.destinationId = destination.id;
    item.draggable = true;
    
    item.innerHTML = `
        <div class="destination-number ${destination.locked ? 'locked' : ''}" 
             title="Click to ${destination.locked ? 'unlock' : 'lock'} position">
            ${number}
        </div>
        <div class="destination-input-wrapper">
            <input type="text" 
                   class="destination-input" 
                   placeholder="Enter destination (e.g., Walmart, 123 Main St...)"
                   value="${destination.address}"
                   autocomplete="off">
            <div class="suggestions-dropdown"></div>
        </div>
        <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
        <button class="delete-btn" title="Remove destination">×</button>
    `;
    
    // Lock/unlock on number click
    const numberEl = item.querySelector('.destination-number');
    numberEl.addEventListener('click', () => toggleDestinationLock(destination.id));
    
    // Delete button
    const deleteBtn = item.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', () => removeDestination(destination.id));
    
    // Input autocomplete
    const input = item.querySelector('.destination-input');
    const suggestions = item.querySelector('.suggestions-dropdown');
    
    setupAutocomplete(input, suggestions, (location) => {
        destination.address = location.address;
        destination.location = location;
        updateOptimizeButton();
    }, true); // Enable time-based search for destinations
    
    // Update address on blur if no autocomplete selection
    input.addEventListener('blur', () => {
        if (input.value !== destination.address) {
            destination.address = input.value;
            destination.location = null; // Will be geocoded during optimization
        }
    });
    
    // Touch swipe to delete
    setupSwipeToDelete(item, () => removeDestination(destination.id));
    
    return item;
}

// ===================================
// Drag and Drop
// ===================================

function initializeDragAndDrop() {
    const items = elements.destinationsList.querySelectorAll('.destination-item');
    
    items.forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', handleDragLeave);
    });
}

let draggedItem = null;

function handleDragStart(e) {
    draggedItem = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.destinationId);
}

function handleDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.destination-item').forEach(item => {
        item.classList.remove('drag-over');
    });
    draggedItem = null;
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
    e.preventDefault();
    if (this !== draggedItem) {
        this.classList.add('drag-over');
    }
}

function handleDragLeave() {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    
    if (draggedItem === this) return;
    
    const draggedId = parseInt(draggedItem.dataset.destinationId);
    const targetId = parseInt(this.dataset.destinationId);
    
    const draggedIndex = state.destinations.findIndex(d => d.id === draggedId);
    const targetIndex = state.destinations.findIndex(d => d.id === targetId);
    
    // Swap positions
    const [removed] = state.destinations.splice(draggedIndex, 1);
    state.destinations.splice(targetIndex, 0, removed);
    
    renderDestinations();
}

// ===================================
// Swipe to Delete (Mobile)
// ===================================

function setupSwipeToDelete(element, onDelete) {
    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    
    element.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isDragging = true;
        element.classList.add('swiping');
    }, { passive: true });
    
    element.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        
        currentX = e.touches[0].clientX;
        const diff = startX - currentX;
        
        if (diff > 0) {
            const translateX = Math.min(diff, 80);
            element.style.transform = `translateX(-${translateX}px)`;
        }
    }, { passive: true });
    
    element.addEventListener('touchend', () => {
        isDragging = false;
        element.classList.remove('swiping');
        
        const diff = startX - currentX;
        
        if (diff > 60) {
            // Swipe threshold reached - delete
            element.style.transform = 'translateX(-100%)';
            element.style.opacity = '0';
            setTimeout(onDelete, 200);
        } else {
            // Reset position
            element.style.transform = '';
        }
    });
}

// ===================================
// Return to Start
// ===================================

function handleReturnToStartChange(e) {
    state.returnToStart = e.target.checked;
}

// ===================================
// Departure Time
// ===================================

function handleDepartureTimeToggle(e) {
    const isEnabled = e.target.checked;
    elements.departureTimeContainer.style.display = isEnabled ? 'block' : 'none';
    
    if (isEnabled) {
        state.departureTime = elements.departureTimeInput.value ? new Date(elements.departureTimeInput.value) : null;
    } else {
        state.departureTime = null;
    }
}

function handleDepartureTimeChange(e) {
    if (elements.useDepartureTimeCheckbox.checked && e.target.value) {
        state.departureTime = new Date(e.target.value);
    }
}

// ===================================
// Update Optimize Button
// ===================================

function updateOptimizeButton() {
    const hasStart = state.startLocation !== null;
    const hasValidDestinations = state.destinations.some(d => d.address.trim() !== '');
    
    elements.optimizeBtn.disabled = !hasStart || !hasValidDestinations || state.isOptimizing;
}

// ===================================
// Route Optimization
// ===================================

async function optimizeRoute() {
    if (state.isOptimizing) return;
    
    state.isOptimizing = true;
    elements.optimizeBtn.querySelector('.btn-text').style.display = 'none';
    elements.optimizeBtn.querySelector('.btn-loading').style.display = 'flex';
    elements.optimizeBtn.disabled = true;
    
    try {
        // Filter destinations with addresses
        const validDestinations = state.destinations.filter(d => d.address.trim() !== '');
        
        if (validDestinations.length === 0) {
            throw new Error('Please add at least one destination');
        }
        
        // Geocode destinations that don't have coordinates
        showToast('Finding nearest locations...', 'success');
        
        for (const dest of validDestinations) {
            if (!dest.location) {
                // Use the improved search that finds nearest locations by driving time
                const results = await searchLocationWithTimes(
                    dest.address,
                    state.startLocation.lat,
                    state.startLocation.lng
                );
                
                if (results.length > 0) {
                    // Results are already sorted by driving time (nearest first)
                    const nearest = results[0];
                    dest.location = {
                        address: nearest.display_name,
                        lat: parseFloat(nearest.lat),
                        lng: parseFloat(nearest.lon)
                    };
                } else {
                    throw new Error(`Could not find location: ${dest.address}`);
                }
            }
        }
        
        // Separate locked and unlocked destinations
        const lockedDests = validDestinations.filter(d => d.locked);
        const unlockedDests = validDestinations.filter(d => !d.locked);
        
        // Calculate distance matrix for unlocked destinations
        showToast('Calculating optimal route...', 'success');
        
        // Get all waypoints including locked ones
        const allWaypoints = [
            state.startLocation,
            ...validDestinations.map(d => d.location),
            ...(state.returnToStart ? [state.startLocation] : [])
        ];
        
        // Calculate original (unoptimized) route
        const originalRoute = await calculateRoute(allWaypoints);
        
        // Optimize unlocked destinations
        let optimizedOrder;
        if (unlockedDests.length > 1) {
            optimizedOrder = await findOptimalOrder(
                state.startLocation,
                validDestinations,
                state.returnToStart
            );
        } else {
            optimizedOrder = validDestinations;
        }
        
        // Calculate optimized route
        const optimizedWaypoints = [
            state.startLocation,
            ...optimizedOrder.map(d => d.location),
            ...(state.returnToStart ? [state.startLocation] : [])
        ];
        
        const optimizedRoute = await calculateRoute(optimizedWaypoints);
        
        // Display results
        displayResults(optimizedOrder, optimizedRoute, originalRoute);
        
    } catch (error) {
        console.error('Optimization error:', error);
        showToast(error.message || 'Optimization failed', 'error');
    } finally {
        state.isOptimizing = false;
        elements.optimizeBtn.querySelector('.btn-text').style.display = 'inline';
        elements.optimizeBtn.querySelector('.btn-loading').style.display = 'none';
        elements.optimizeBtn.disabled = false;
    }
}

// ===================================
// Optimal Order Algorithm (TSP-like)
// ===================================

async function findOptimalOrder(start, destinations, returnToStart) {
    const locked = destinations.filter(d => d.locked);
    const unlocked = destinations.filter(d => !d.locked);
    
    if (unlocked.length <= 1) {
        return destinations;
    }
    
    // Use nearest neighbor heuristic for unlocked destinations
    // This is a simple but effective approach for small numbers of stops
    
    const result = [];
    const unvisited = [...unlocked];
    let current = start;
    
    // Build the route considering locked positions
    for (let i = 0; i < destinations.length; i++) {
        const originalDest = destinations[i];
        
        if (originalDest.locked) {
            // Keep locked destinations in their position
            result.push(originalDest);
            current = originalDest.location;
            // Remove from unvisited if it was there
            const idx = unvisited.findIndex(d => d.id === originalDest.id);
            if (idx !== -1) unvisited.splice(idx, 1);
        } else if (unvisited.length > 0) {
            // Find nearest unvisited destination
            let nearestIdx = 0;
            let nearestDist = Infinity;
            
            for (let j = 0; j < unvisited.length; j++) {
                const dist = calculateDistance(
                    current.lat, current.lng,
                    unvisited[j].location.lat, unvisited[j].location.lng
                );
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestIdx = j;
                }
            }
            
            const nearest = unvisited.splice(nearestIdx, 1)[0];
            result.push(nearest);
            current = nearest.location;
        }
    }
    
    // Add any remaining unvisited destinations
    while (unvisited.length > 0) {
        let nearestIdx = 0;
        let nearestDist = Infinity;
        
        for (let j = 0; j < unvisited.length; j++) {
            const dist = calculateDistance(
                current.lat, current.lng,
                unvisited[j].location.lat, unvisited[j].location.lng
            );
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestIdx = j;
            }
        }
        
        const nearest = unvisited.splice(nearestIdx, 1)[0];
        result.push(nearest);
        current = nearest.location;
    }
    
    return result;
}

// Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function toRad(deg) {
    return deg * Math.PI / 180;
}

// ===================================
// Route Calculation (OSRM with Fallbacks)
// ===================================

// List of OSRM routing servers to try (primary and fallbacks)
const ROUTING_SERVERS = [
    'https://router.project-osrm.org',
    'https://routing.openstreetmap.de/routed-car'
];

// Check if the browser is online
function isOnline() {
    return navigator.onLine !== false;
}

// Test network connectivity by making a lightweight request
async function testNetworkConnectivity() {
    try {
        // Use a lightweight request to test connectivity
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch('https://nominatim.openstreetmap.org/status.php', {
            method: 'HEAD',
            signal: controller.signal,
            cache: 'no-store'
        });
        
        clearTimeout(timeoutId);
        return response.ok;
    } catch (error) {
        console.warn('Network connectivity test failed:', error.message);
        return false;
    }
}

// Validate waypoints before making routing request
function validateWaypoints(waypoints) {
    if (!waypoints || waypoints.length < 2) {
        return { valid: false, error: 'At least two locations are required for routing.' };
    }
    
    for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        if (!wp || typeof wp.lat !== 'number' || typeof wp.lng !== 'number') {
            return { valid: false, error: `Invalid coordinates for waypoint ${i + 1}. Please re-enter the address.` };
        }
        if (wp.lat < -90 || wp.lat > 90 || wp.lng < -180 || wp.lng > 180) {
            return { valid: false, error: `Coordinates out of range for waypoint ${i + 1}. Please re-enter the address.` };
        }
        if (isNaN(wp.lat) || isNaN(wp.lng)) {
            return { valid: false, error: `Invalid coordinates for waypoint ${i + 1}. Please re-enter the address.` };
        }
    }
    
    return { valid: true };
}

// Try to calculate route using a specific server
async function tryRouteServer(serverUrl, coords, timeoutMs = 20000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
        const url = `${serverUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
        console.log(`Trying routing server: ${serverUrl}`);
        
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json'
            }
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorInfo = {
                status: response.status,
                statusText: response.statusText,
                server: serverUrl
            };
            
            if (response.status === 429) {
                return { success: false, retryable: true, error: 'Rate limited', errorInfo };
            }
            if (response.status >= 500) {
                return { success: false, retryable: true, error: 'Server error', errorInfo };
            }
            if (response.status === 400) {
                return { success: false, retryable: false, error: 'Invalid request', errorInfo };
            }
            
            return { success: false, retryable: true, error: `HTTP ${response.status}`, errorInfo };
        }
        
        const data = await response.json();
        
        // Handle OSRM-specific error codes
        if (data.code === 'NoRoute') {
            return { 
                success: false, 
                retryable: false, 
                error: 'No driving route exists between these locations. They may be on different landmasses or not accessible by road.'
            };
        }
        
        if (data.code === 'NoSegment') {
            return { 
                success: false, 
                retryable: false, 
                error: 'One or more locations are too far from a road. Please choose locations closer to roads.'
            };
        }
        
        if (data.code === 'InvalidInput' || data.code === 'InvalidQuery') {
            return { 
                success: false, 
                retryable: false, 
                error: 'Invalid location coordinates. Please re-enter the addresses.'
            };
        }
        
        if (data.code === 'TooBig') {
            return { 
                success: false, 
                retryable: false, 
                error: 'Route is too long. Please reduce the number of destinations or choose closer locations.'
            };
        }
        
        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
            return { 
                success: false, 
                retryable: true, 
                error: `Unexpected response from routing service: ${data.code || 'No routes returned'}`
            };
        }
        
        // Success!
        return {
            success: true,
            data: {
                duration: data.routes[0].duration,
                distance: data.routes[0].distance,
                geometry: data.routes[0].geometry
            }
        };
        
    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
            return { 
                success: false, 
                retryable: true, 
                error: 'Request timed out',
                errorInfo: { server: serverUrl, timeout: timeoutMs }
            };
        }
        
        if (error.name === 'TypeError') {
            // Network error (CORS, DNS, connection refused, etc.)
            return { 
                success: false, 
                retryable: true, 
                error: 'Network error',
                errorInfo: { server: serverUrl, message: error.message }
            };
        }
        
        return { 
            success: false, 
            retryable: true, 
            error: error.message || 'Unknown error',
            errorInfo: { server: serverUrl }
        };
    }
}

// Calculate a fallback route using straight-line distances when routing fails
function calculateFallbackRoute(waypoints) {
    let totalDistance = 0;
    const coordinates = [];
    
    for (let i = 0; i < waypoints.length; i++) {
        coordinates.push([waypoints[i].lng, waypoints[i].lat]);
        
        if (i > 0) {
            totalDistance += calculateDistance(
                waypoints[i-1].lat, waypoints[i-1].lng,
                waypoints[i].lat, waypoints[i].lng
            ) * 1000; // Convert km to meters
        }
    }
    
    // Estimate duration: assume average speed of 50 km/h (city driving)
    const estimatedDuration = (totalDistance / 1000) / 50 * 3600; // seconds
    
    return {
        duration: estimatedDuration,
        distance: totalDistance,
        geometry: {
            type: 'LineString',
            coordinates: coordinates
        },
        isFallback: true
    };
}

// Main route calculation function with comprehensive error handling
async function calculateRoute(waypoints, options = {}) {
    const { maxRetries = 2, useFallback = true } = options;
    
    // Step 1: Validate waypoints
    const validation = validateWaypoints(waypoints);
    if (!validation.valid) {
        throw new Error(validation.error);
    }
    
    // Step 2: Check browser online status
    if (!isOnline()) {
        if (useFallback) {
            showToast('Offline: Using estimated route', 'warning');
            return calculateFallbackRoute(waypoints);
        }
        throw new Error('You appear to be offline. Please check your internet connection and try again.');
    }
    
    // Step 3: Build coordinates string
    const coords = waypoints.map(wp => `${wp.lng.toFixed(6)},${wp.lat.toFixed(6)}`).join(';');
    
    // Step 4: Try each routing server with retries
    const errors = [];
    
    for (const serverUrl of ROUTING_SERVERS) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const result = await tryRouteServer(serverUrl, coords);
            
            if (result.success) {
                console.log(`Route calculated successfully using ${serverUrl}`);
                return result.data;
            }
            
            errors.push({
                server: serverUrl,
                attempt: attempt + 1,
                error: result.error,
                errorInfo: result.errorInfo
            });
            
            // Don't retry non-retryable errors
            if (!result.retryable) {
                console.warn(`Non-retryable error from ${serverUrl}:`, result.error);
                break;
            }
            
            // Wait before retry with exponential backoff
            if (attempt < maxRetries) {
                const waitTime = Math.min(1000 * Math.pow(2, attempt), 5000);
                console.log(`Retrying in ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    
    // Step 5: All servers failed - analyze errors and provide helpful message
    console.error('All routing attempts failed:', errors);
    
    // Check if all errors are network-related
    const allNetworkErrors = errors.every(e => 
        e.error === 'Network error' || 
        e.error === 'Request timed out'
    );
    
    if (allNetworkErrors) {
        // Double-check network connectivity
        const hasConnectivity = await testNetworkConnectivity();
        
        if (!hasConnectivity) {
            if (useFallback) {
                showToast('Network issue: Using estimated route', 'warning');
                return calculateFallbackRoute(waypoints);
            }
            throw new Error('Unable to connect to routing services. Please check your internet connection and try again.');
        } else {
            // Network works but routing servers are down
            if (useFallback) {
                showToast('Routing servers unavailable: Using estimated route', 'warning');
                return calculateFallbackRoute(waypoints);
            }
            throw new Error('Routing services are temporarily unavailable. Please try again in a few minutes.');
        }
    }
    
    // Check for specific non-retryable errors
    const nonRetryableError = errors.find(e => 
        e.error.includes('No driving route') ||
        e.error.includes('too far from a road') ||
        e.error.includes('Invalid location') ||
        e.error.includes('too long')
    );
    
    if (nonRetryableError) {
        throw new Error(nonRetryableError.error);
    }
    
    // Check if rate limited
    const rateLimited = errors.some(e => e.error === 'Rate limited');
    if (rateLimited) {
        throw new Error('Route calculation service is busy. Please wait a moment and try again.');
    }
    
    // Generic fallback error
    if (useFallback) {
        showToast('Route calculation failed: Using estimated route', 'warning');
        return calculateFallbackRoute(waypoints);
    }
    
    throw new Error('Unable to calculate route. Please verify your destinations and try again.');
}

// ===================================
// Display Results
// ===================================

function displayResults(optimizedOrder, optimizedRoute, originalRoute) {
    // Show results section
    elements.resultsSection.style.display = 'block';
    
    // Calculate time saved
    const timeSaved = Math.max(0, originalRoute.duration - optimizedRoute.duration);
    
    // Check if using fallback/estimated route
    const isEstimated = optimizedRoute.isFallback || originalRoute.isFallback;
    const estimateSuffix = isEstimated ? ' (est.)' : '';
    
    // Update stats
    elements.optimizedTime.textContent = formatDuration(optimizedRoute.duration) + estimateSuffix;
    elements.timeSaved.textContent = formatDuration(timeSaved) + estimateSuffix;
    elements.totalDistance.textContent = formatDistance(optimizedRoute.distance) + estimateSuffix;
    
    // Update optimized order list
    elements.optimizedOrderList.innerHTML = '';
    
    // Add start location
    const startItem = document.createElement('li');
    startItem.innerHTML = `<strong>Start:</strong> ${truncateAddress(state.startLocation.address)}`;
    elements.optimizedOrderList.appendChild(startItem);
    
    // Add destinations
    optimizedOrder.forEach((dest, index) => {
        const li = document.createElement('li');
        li.className = dest.locked ? 'locked' : '';
        li.textContent = truncateAddress(dest.address || dest.location.address);
        elements.optimizedOrderList.appendChild(li);
    });
    
    // Add return to start if enabled
    if (state.returnToStart) {
        const returnItem = document.createElement('li');
        returnItem.className = 'locked';
        returnItem.innerHTML = `<strong>Return:</strong> ${truncateAddress(state.startLocation.address)}`;
        elements.optimizedOrderList.appendChild(returnItem);
    }
    
    // Update map
    displayMap(optimizedOrder, optimizedRoute.geometry);
    
    // Store for Google Maps export
    state.optimizedOrder = optimizedOrder;
    
    // Scroll to results
    elements.resultsSection.scrollIntoView({ behavior: 'smooth' });
    
    // Show appropriate toast message
    if (isEstimated) {
        showToast('Route optimized (estimated times - check Google Maps for accuracy)', 'warning');
    } else {
        showToast('Route optimized!', 'success');
    }
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes} min`;
}

function formatDistance(meters) {
    const miles = meters / 1609.344;
    if (miles < 0.1) {
        const feet = meters * 3.28084;
        return `${Math.round(feet)} ft`;
    }
    return `${miles.toFixed(1)} mi`;
}

function truncateAddress(address) {
    if (address.length > 50) {
        return address.substring(0, 47) + '...';
    }
    return address;
}

// ===================================
// Map Display
// ===================================

function displayMap(destinations, geometry) {
    // Check if Leaflet is loaded
    if (typeof L === 'undefined') {
        console.warn('Leaflet library not loaded. Map display skipped.');
        document.getElementById('map').innerHTML = '<div class="map-loading-message">📍 Map loading... If this persists, please check your internet connection.</div>';
        return;
    }
    
    // Initialize map if not exists
    if (!state.map) {
        state.map = L.map('map');
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(state.map);
        
        state.routeLayer = L.layerGroup().addTo(state.map);
        state.markersLayer = L.layerGroup().addTo(state.map);
    }
    
    // Clear existing layers
    state.routeLayer.clearLayers();
    state.markersLayer.clearLayers();
    
    // Add route line
    if (geometry && geometry.coordinates) {
        const routeLine = L.geoJSON(geometry, {
            style: {
                color: '#4A90D9',
                weight: 4,
                opacity: 0.8
            }
        });
        state.routeLayer.addLayer(routeLine);
    }
    
    // Add markers
    const allPoints = [
        { ...state.startLocation, label: 'Start', isStart: true },
        ...destinations.map((d, i) => ({
            ...d.location,
            label: String(i + 1),
            locked: d.locked
        })),
        ...(state.returnToStart ? [{ ...state.startLocation, label: 'End', isEnd: true }] : [])
    ];
    
    const bounds = L.latLngBounds();
    
    allPoints.forEach(point => {
        const color = point.isStart || point.isEnd ? '#4A90D9' : 
                     point.locked ? '#F39C12' : '#27AE60';
        
        const marker = L.circleMarker([point.lat, point.lng], {
            radius: 12,
            fillColor: color,
            color: '#fff',
            weight: 2,
            fillOpacity: 1
        });
        
        marker.bindTooltip(point.label, {
            permanent: true,
            direction: 'center',
            className: 'marker-label'
        });
        
        state.markersLayer.addLayer(marker);
        bounds.extend([point.lat, point.lng]);
    });
    
    // Fit map to bounds
    state.map.fitBounds(bounds, { padding: [30, 30] });
}

// ===================================
// Google Maps Export
// ===================================

function openInGoogleMaps() {
    if (!state.optimizedOrder || state.optimizedOrder.length === 0) {
        showToast('Please optimize route first', 'error');
        return;
    }
    
    // Build Google Maps URL
    // Format: https://www.google.com/maps/dir/origin/waypoint1/waypoint2/.../destination
    
    const origin = `${state.startLocation.lat},${state.startLocation.lng}`;
    const waypoints = state.optimizedOrder.map(d => 
        `${d.location.lat},${d.location.lng}`
    );
    
    let destination = waypoints[waypoints.length - 1];
    if (state.returnToStart) {
        destination = origin;
    }
    
    // Google Maps URL structure
    let url = `https://www.google.com/maps/dir/${origin}`;
    
    // Add waypoints (all except the last if not returning to start)
    const waypointCount = state.returnToStart ? waypoints.length : waypoints.length - 1;
    for (let i = 0; i < waypointCount; i++) {
        url += `/${waypoints[i]}`;
    }
    
    url += `/${destination}`;
    
    // Add departure time if set (Google Maps uses travelmode and departure time)
    if (state.departureTime) {
        const timestamp = Math.floor(state.departureTime.getTime() / 1000);
        url += `?travelmode=driving`;
    }
    
    // Open in new tab - Google Maps will show real-time traffic
    window.open(url, '_blank');
    showToast('Opening Google Maps with traffic data...', 'success');
}

// ===================================
// Toast Notifications
// ===================================

let toastTimeout = null;

function showToast(message, type = 'info') {
    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }
    
    elements.toast.textContent = message;
    elements.toast.className = `toast ${type}`;
    elements.toast.classList.add('show');
    
    toastTimeout = setTimeout(() => {
        elements.toast.classList.remove('show');
    }, 3000);
}
